import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MutualFundCalculatorServer {
    private static final int PORT = 8080;
    private static final double DEFAULT_RISK_FREE_RATE = 0.043; // Fallback if FRED is unavailable.
    private static final String FRED_API_KEY = System.getenv("FRED_API_KEY");
    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 5000;
    private static final int FRED_CONNECT_TIMEOUT_MS = 10000;
    private static final int FRED_READ_TIMEOUT_MS = 20000;
    private static final long BETA_CACHE_TTL_MS = 24L * 60L * 60L * 1000L;
    private static final long MARKET_RETURN_CACHE_TTL_MS = 24L * 60L * 60L * 1000L;
    private static final long RISK_FREE_CACHE_TTL_MS = 60L * 60L * 1000L;
    private static final long RISK_FREE_FALLBACK_CACHE_TTL_MS = 10L * 60L * 1000L;

    private static final List<Fund> FUNDS;
    private static final Map<String, TimedValue> BETA_CACHE = new HashMap<String, TimedValue>();
    private static TimedValue cachedRiskFreeRate;
    private static TimedValue cachedExpectedMarketReturn;

    static {
        List<Fund> funds = new ArrayList<Fund>();
        funds.add(new Fund("VSMPX", "Vanguard Total Stock Market Index Fund Institutional Plus"));
        funds.add(new Fund("FXAIX", "Fidelity 500 Index Fund"));
        funds.add(new Fund("VFIAX", "Vanguard 500 Index Fund Admiral Shares"));
        funds.add(new Fund("VTSAX", "Vanguard Total Stock Market Index Fund Admiral Shares"));
        funds.add(new Fund("VMFXX", "Vanguard Federal Money Market Fund Investor"));
        funds.add(new Fund("VGTSX", "Vanguard Total International Stock Index Fund Investor"));
        funds.add(new Fund("SWVXX", "Schwab Value Advantage Money Fund Investor"));
        funds.add(new Fund("FGTXX", "Goldman Sachs FS Government Fund Institutional"));
        funds.add(new Fund("FCTDX", "Fidelity Strategic Advisers Fidelity U.S. Total Stock Fund"));
        funds.add(new Fund("VIIIX", "Vanguard Institutional Index Fund Institutional Plus"));
        funds.add(new Fund("VTBNX", "Vanguard Total Bond Market II Index Fund Institutional"));
        funds.add(new Fund("MVRXX", "Morgan Stanley Institutional Liquidity Government Portfolio Institutional"));
        funds.add(new Fund("GVMXX", "State Street U.S. Government Money Market Fund Premier"));
        funds.add(new Fund("AGTHX", "American Funds Growth Fund of America A"));
        funds.add(new Fund("VTBIX", "Vanguard Total Bond Market II Index Fund Investor"));
        funds.add(new Fund("FCNTX", "Fidelity Contrafund"));
        funds.add(new Fund("SNAXX", "Schwab Value Advantage Money Fund Ultra"));
        funds.add(new Fund("PIMIX", "PIMCO Income Fund Institutional"));
        FUNDS = Collections.unmodifiableList(funds);
    }

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/api/funds", new FundsHandler());
        server.createContext("/api/investment/future-value", new FutureValueHandler());
        server.createContext("/api/health", new HealthHandler());
        server.setExecutor(null);

        System.out.println("Mutual Fund Calculator backend listening on http://localhost:" + PORT);
        server.start();
    }

    private static class FundsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Only GET is allowed.");
                return;
            }

            StringBuilder body = new StringBuilder();
            body.append("{\"funds\":[");
            for (int i = 0; i < FUNDS.size(); i++) {
                Fund fund = FUNDS.get(i);
                if (i > 0) {
                    body.append(',');
                }
                body.append("{\"ticker\":\"").append(escapeJson(fund.ticker)).append("\",")
                    .append("\"name\":\"").append(escapeJson(fund.name)).append("\"}");
            }
            body.append("]}");
            sendJson(exchange, 200, body.toString());
        }
    }

    private static class FutureValueHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Only GET is allowed.");
                return;
            }

            Map<String, String> query = parseQuery(exchange.getRequestURI().getRawQuery());
            String ticker = normalizeTicker(query.get("ticker"));
            String principalInput = query.get("principal");
            String yearsInput = query.get("years");

            if (ticker == null || ticker.isEmpty()) {
                sendError(exchange, 400, "Missing required query parameter: ticker");
                return;
            }

            if (!isSupportedTicker(ticker)) {
                sendError(exchange, 400, "Unsupported ticker. Use /api/funds to choose a valid mutual fund.");
                return;
            }

            double principal;
            double years;
            try {
                principal = Double.parseDouble(principalInput);
                years = Double.parseDouble(yearsInput);
            } catch (Exception e) {
                sendError(exchange, 400, "principal and years must be numeric values.");
                return;
            }

            if (principal <= 0 || years <= 0) {
                sendError(exchange, 400, "principal and years must be greater than zero.");
                return;
            }

            try {
                double riskFreeRate = fetchRiskFreeRateFromFred();
                double beta = fetchBetaFromNewton(ticker);
                double expectedReturnRate = fetchExpectedAnnualMarketReturnFromYahooSp500();
                double capmRate = riskFreeRate + beta * (expectedReturnRate - riskFreeRate);
                double futureValue = principal * Math.pow(1.0 + capmRate, years);

                StringBuilder body = new StringBuilder();
                body.append("{")
                    .append("\"ticker\":\"").append(escapeJson(ticker)).append("\",")
                    .append("\"principal\":").append(round(principal, 2)).append(',')
                    .append("\"years\":").append(round(years, 2)).append(',')
                    .append("\"riskFreeRate\":").append(round(riskFreeRate, 6)).append(',')
                    .append("\"beta\":").append(round(beta, 6)).append(',')
                    .append("\"expectedReturnRate\":").append(round(expectedReturnRate, 6)).append(',')
                    .append("\"capmRate\":").append(round(capmRate, 6)).append(',')
                    .append("\"futureValue\":").append(round(futureValue, 2))
                    .append("}");

                sendJson(exchange, 200, body.toString());
            } catch (ExternalDataException e) {
                sendError(exchange, 502, "Unable to retrieve market data: " + e.getMessage());
            } catch (Exception e) {
                sendError(exchange, 500, "Unexpected error while calculating future value.");
            }
        }
    }

    private static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Only GET is allowed.");
                return;
            }
            sendJson(exchange, 200, "{\"status\":\"ok\"}");
        }
    }

    private static boolean isSupportedTicker(String ticker) {
        for (Fund fund : FUNDS) {
            if (fund.ticker.equalsIgnoreCase(ticker)) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeTicker(String ticker) {
        if (ticker == null) {
            return null;
        }
        return ticker.trim().toUpperCase();
    }

    private static double fetchBetaFromNewton(String ticker) throws ExternalDataException {
        long now = System.currentTimeMillis();
        synchronized (BETA_CACHE) {
            TimedValue cached = BETA_CACHE.get(ticker);
            if (cached != null && cached.isValid(now)) {
                return cached.value;
            }
        }

        try {
            String endpoint = "https://api.newtonanalytics.com/stock-beta/?ticker=" +
                URLEncoder.encode(ticker, "UTF-8") +
                "&index=%5EGSPC&interval=1mo&observations=12";
            String response = httpGet(endpoint, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);
            double beta;
            if (response.contains("\"beta\"")) {
                beta = extractNumericField(response, "beta");
            } else {
                beta = extractNumericField(response, "data");
            }

            synchronized (BETA_CACHE) {
                BETA_CACHE.put(ticker, new TimedValue(beta, System.currentTimeMillis() + BETA_CACHE_TTL_MS));
            }
            return beta;
        } catch (IOException e) {
            throw new ExternalDataException("Newton API connection failed", e);
        }
    }

    private static double fetchRiskFreeRateFromFred() throws ExternalDataException {
        synchronized (MutualFundCalculatorServer.class) {
            if (cachedRiskFreeRate != null && cachedRiskFreeRate.isValid(System.currentTimeMillis())) {
                return cachedRiskFreeRate.value;
            }
        }

        String today = LocalDate.now().toString();
        String thirtyDaysAgo = LocalDate.now().minusDays(30).toString();
        String sixtyDaysAgo = LocalDate.now().minusDays(60).toString();
        String[] endpoints = new String[] {
            "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=" + thirtyDaysAgo + "&coed=" + today,
            "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=" + sixtyDaysAgo + "&coed=" + today
        };

        String lastFailure = "unknown";
        if (hasText(FRED_API_KEY)) {
            long startMs = System.currentTimeMillis();
            try {
                double value = fetchRiskFreeRateFromFredApi(FRED_API_KEY.trim());
                synchronized (MutualFundCalculatorServer.class) {
                    cachedRiskFreeRate = new TimedValue(value, System.currentTimeMillis() + RISK_FREE_CACHE_TTL_MS);
                }
                System.out.println("FRED success via official API in " + (System.currentTimeMillis() - startMs) + "ms");
                return value;
            } catch (Exception e) {
                lastFailure = "official-api -> " + e.getClass().getSimpleName() + ": " + safeMessage(e);
                System.err.println("FRED official API failed in " + (System.currentTimeMillis() - startMs) +
                    "ms: " + safeMessage(e));
            }
        } else {
            System.err.println("FRED_API_KEY is not set; using CSV fallback endpoints.");
        }

        for (String endpoint : endpoints) {
            long javaStartMs = System.currentTimeMillis();
            try {
                String response = httpGet(endpoint, FRED_CONNECT_TIMEOUT_MS, FRED_READ_TIMEOUT_MS);
                double value = extractLatestFredRate(response);
                synchronized (MutualFundCalculatorServer.class) {
                    cachedRiskFreeRate = new TimedValue(value, System.currentTimeMillis() + RISK_FREE_CACHE_TTL_MS);
                }
                System.out.println("FRED success via Java CSV in " + (System.currentTimeMillis() - javaStartMs) +
                    "ms endpoint=" + endpoint);
                return value;
            } catch (IOException e) {
                lastFailure = endpoint + " -> java: " + e.getClass().getSimpleName() + ": " + safeMessage(e) +
                    " (" + (System.currentTimeMillis() - javaStartMs) + "ms)";
                System.err.println("FRED Java fetch failed: " + lastFailure);
                long curlStartMs = System.currentTimeMillis();
                try {
                    String response = httpGetViaCurl(endpoint, FRED_CONNECT_TIMEOUT_MS, FRED_READ_TIMEOUT_MS);
                    double value = extractLatestFredRate(response);
                    synchronized (MutualFundCalculatorServer.class) {
                        cachedRiskFreeRate = new TimedValue(value, System.currentTimeMillis() + RISK_FREE_CACHE_TTL_MS);
                    }
                    System.out.println("FRED success via curl CSV in " + (System.currentTimeMillis() - curlStartMs) +
                        "ms endpoint=" + endpoint);
                    return value;
                } catch (Exception curlError) {
                    lastFailure = endpoint + " -> java: " + e.getClass().getSimpleName() + ": " + safeMessage(e)
                        + " | curl: " + curlError.getClass().getSimpleName() + ": " + safeMessage(curlError)
                        + " (" + (System.currentTimeMillis() - curlStartMs) + "ms)";
                }
            } catch (ExternalDataException e) {
                lastFailure = endpoint + " -> parse: " + safeMessage(e) +
                    " (" + (System.currentTimeMillis() - javaStartMs) + "ms)";
                System.err.println("FRED Java parse failed: " + lastFailure);
                long curlStartMs = System.currentTimeMillis();
                try {
                    String response = httpGetViaCurl(endpoint, FRED_CONNECT_TIMEOUT_MS, FRED_READ_TIMEOUT_MS);
                    double value = extractLatestFredRate(response);
                    synchronized (MutualFundCalculatorServer.class) {
                        cachedRiskFreeRate = new TimedValue(value, System.currentTimeMillis() + RISK_FREE_CACHE_TTL_MS);
                    }
                    System.out.println("FRED success via curl CSV in " + (System.currentTimeMillis() - curlStartMs) +
                        "ms endpoint=" + endpoint);
                    return value;
                } catch (Exception curlError) {
                    lastFailure = endpoint + " -> parse: " + safeMessage(e)
                        + " | curl: " + curlError.getClass().getSimpleName() + ": " + safeMessage(curlError)
                        + " (" + (System.currentTimeMillis() - curlStartMs) + "ms)";
                }
            }
        }

        System.err.println(
            "Warning: FRED unavailable. Falling back to default risk-free rate " +
            DEFAULT_RISK_FREE_RATE + ". Last failure: " + lastFailure
        );
        synchronized (MutualFundCalculatorServer.class) {
            cachedRiskFreeRate = new TimedValue(
                DEFAULT_RISK_FREE_RATE,
                System.currentTimeMillis() + RISK_FREE_FALLBACK_CACHE_TTL_MS
            );
        }
        return DEFAULT_RISK_FREE_RATE;
    }

    private static double fetchRiskFreeRateFromFredApi(String apiKey) throws ExternalDataException {
        try {
            String endpoint = "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10" +
                "&sort_order=desc&limit=10&file_type=json&api_key=" + URLEncoder.encode(apiKey, "UTF-8");
            String response = httpGet(endpoint, FRED_CONNECT_TIMEOUT_MS, FRED_READ_TIMEOUT_MS);
            return extractLatestFredRateFromJson(response);
        } catch (IOException e) {
            throw new ExternalDataException("FRED official API connection failed", e);
        }
    }

    private static double fetchExpectedAnnualMarketReturnFromYahooSp500() throws ExternalDataException {
        synchronized (MutualFundCalculatorServer.class) {
            if (cachedExpectedMarketReturn != null && cachedExpectedMarketReturn.isValid(System.currentTimeMillis())) {
                return cachedExpectedMarketReturn.value;
            }
        }

        try {
            String endpoint = "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5y&interval=1mo&events=history";
            String response = httpGet(endpoint, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);

            // Calculate average annualized return from 5 years of monthly S&P 500 closes.
            List<Double> closes = extractCloseValues(response);
            if (closes.size() < 2) {
                throw new ExternalDataException("Insufficient close-price data from Yahoo Finance", null);
            }

            double compoundedGrowth = 1.0;
            int periods = 0;
            for (int i = 1; i < closes.size(); i++) {
                double previous = closes.get(i - 1);
                double current = closes.get(i);
                if (previous <= 0 || current <= 0) {
                    continue;
                }
                compoundedGrowth *= (current / previous);
                periods++;
            }
            if (periods == 0) {
                throw new ExternalDataException("No valid return periods in Yahoo Finance data", null);
            }

            double annualizedReturn = Math.pow(compoundedGrowth, 12.0 / periods) - 1.0;
            synchronized (MutualFundCalculatorServer.class) {
                cachedExpectedMarketReturn = new TimedValue(
                    annualizedReturn,
                    System.currentTimeMillis() + MARKET_RETURN_CACHE_TTL_MS
                );
            }
            return annualizedReturn;
        } catch (IOException e) {
            throw new ExternalDataException("Yahoo Finance connection failed", e);
        }
    }

    private static double extractLatestFredRate(String csv) throws ExternalDataException {
        String[] lines = csv.split("\\r?\\n");
        for (int i = lines.length - 1; i >= 1; i--) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }

            String[] columns = line.split(",", 2);
            if (columns.length < 2) {
                continue;
            }

            String value = columns[1].trim();
            if (value.isEmpty() || ".".equals(value)) {
                continue;
            }

            try {
                return Double.parseDouble(value) / 100.0;
            } catch (NumberFormatException ignored) {
                // Keep scanning for a valid numeric row.
            }
        }

        throw new ExternalDataException("No valid DGS10 value found in FRED response", null);
    }

    private static double extractLatestFredRateFromJson(String json) throws ExternalDataException {
        Pattern pattern = Pattern.compile("\\\"value\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
        Matcher matcher = pattern.matcher(json);
        while (matcher.find()) {
            String value = matcher.group(1).trim();
            if (value.isEmpty() || ".".equals(value)) {
                continue;
            }
            try {
                return Double.parseDouble(value) / 100.0;
            } catch (NumberFormatException ignored) {
                // Keep scanning for a valid numeric value.
            }
        }
        throw new ExternalDataException("No valid DGS10 value found in FRED JSON response", null);
    }

    private static String httpGet(String endpoint, int connectTimeoutMs, int readTimeoutMs) throws IOException, ExternalDataException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestProperty("Accept", "*/*");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0");
            if (endpoint.contains("stlouisfed.org")) {
                connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
                connection.setRequestProperty("Referer", "https://fred.stlouisfed.org/");
                connection.setRequestProperty("Cache-Control", "no-cache");
            }

            int code = connection.getResponseCode();
            InputStream stream;
            if (code >= 200 && code < 300) {
                stream = connection.getInputStream();
            } else {
                stream = connection.getErrorStream();
                String body = stream == null ? "" : readStream(stream);
                throw new ExternalDataException("HTTP " + code + " from " + endpoint + " body=" + body, null);
            }
            return readStream(stream);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String httpGetViaCurl(String endpoint, int connectTimeoutMs, int readTimeoutMs) throws IOException, ExternalDataException {
        int maxTimeSeconds = Math.max(5, (connectTimeoutMs + readTimeoutMs) / 1000);
        ProcessBuilder pb = new ProcessBuilder(
            "curl",
            "--http1.1",
            "-L",
            "--silent",
            "--show-error",
            "--retry", "2",
            "--retry-delay", "1",
            "--connect-timeout", String.valueOf(Math.max(3, connectTimeoutMs / 1000)),
            "--max-time", String.valueOf(maxTimeSeconds),
            "-A", "Mozilla/5.0",
            "-H", "Accept: text/csv,*/*;q=0.9",
            endpoint
        );
        Process process = pb.start();
        byte[] stdout = readAllBytes(process.getInputStream());
        byte[] stderr = readAllBytes(process.getErrorStream());
        try {
            int exitCode = process.waitFor();
            if (exitCode != 0) {
                throw new ExternalDataException("curl failed with exit " + exitCode + " stderr=" +
                    new String(stderr, StandardCharsets.UTF_8), null);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while waiting for curl", e);
        }

        return new String(stdout, StandardCharsets.UTF_8);
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String safeMessage(Throwable throwable) {
        if (throwable == null || throwable.getMessage() == null) {
            return "(no message)";
        }
        return throwable.getMessage();
    }

    private static byte[] readAllBytes(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) != -1) {
            buffer.write(chunk, 0, n);
        }
        return buffer.toByteArray();
    }

    private static String readStream(InputStream stream) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line).append('\n');
        }
        return sb.toString();
    }

    private static double extractNumericField(String json, String fieldName) throws ExternalDataException {
        Pattern pattern = Pattern.compile("\\\"" + Pattern.quote(fieldName) + "\\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)");
        Matcher matcher = pattern.matcher(json);
        if (!matcher.find()) {
            throw new ExternalDataException("Field '" + fieldName + "' not found in response", null);
        }
        try {
            return Double.parseDouble(matcher.group(1));
        } catch (NumberFormatException e) {
            throw new ExternalDataException("Field '" + fieldName + "' could not be parsed", e);
        }
    }

    private static List<Double> extractCloseValues(String json) {
        Pattern pattern = Pattern.compile("\\\"close\\\"\\s*:\\s*\\[(.*?)\\]", Pattern.DOTALL);
        Matcher matcher = pattern.matcher(json);
        if (!matcher.find()) {
            return Collections.emptyList();
        }

        String values = matcher.group(1);
        String[] tokens = values.split(",");
        List<Double> closes = new ArrayList<Double>();
        for (String token : tokens) {
            String value = token.trim();
            if (value.isEmpty() || "null".equalsIgnoreCase(value)) {
                continue;
            }
            try {
                closes.add(Double.parseDouble(value));
            } catch (NumberFormatException ignored) {
                // Ignore invalid numeric values in the source response.
            }
        }
        return closes;
    }

    private static Map<String, String> parseQuery(String rawQuery) {
        Map<String, String> query = new HashMap<String, String>();
        if (rawQuery == null || rawQuery.isEmpty()) {
            return query;
        }

        String[] params = rawQuery.split("&");
        for (String param : params) {
            String[] pair = param.split("=", 2);
            String key = decodeUrl(pair[0]);
            String value = pair.length > 1 ? decodeUrl(pair[1]) : "";
            query.put(key, value);
        }
        return query;
    }

    private static String decodeUrl(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private static String escapeJson(String input) {
        if (input == null) {
            return "";
        }
        return input.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String round(double value, int decimals) {
        BigDecimal bd = new BigDecimal(value).setScale(decimals, RoundingMode.HALF_UP);
        return bd.stripTrailingZeros().toPlainString();
    }

    private static void sendJson(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
            return;
        }

        exchange.sendResponseHeaders(status, bytes.length);
        OutputStream os = exchange.getResponseBody();
        os.write(bytes);
        os.close();
    }

    private static void sendError(HttpExchange exchange, int status, String message) throws IOException {
        String body = "{\"error\":\"" + escapeJson(message) + "\"}";
        sendJson(exchange, status, body);
    }

    private static class Fund {
        private final String ticker;
        private final String name;

        private Fund(String ticker, String name) {
            this.ticker = ticker;
            this.name = name;
        }
    }

    private static class ExternalDataException extends Exception {
        private ExternalDataException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private static class TimedValue {
        private final double value;
        private final long expiresAtMs;

        private TimedValue(double value, long expiresAtMs) {
            this.value = value;
            this.expiresAtMs = expiresAtMs;
        }

        private boolean isValid(long nowMs) {
            return nowMs < expiresAtMs;
        }
    }
}
