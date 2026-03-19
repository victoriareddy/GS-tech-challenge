import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MutualFundCalculatorServer {
    private static final int PORT = 8080;
    private static final double RISK_FREE_RATE = 0.043; // 4.30%

    private static final List<Fund> FUNDS;

    static {
        List<Fund> funds = new ArrayList<Fund>();
        funds.add(new Fund("VSMPX", "Vanguard Total Stock Market Index Fund Institutional Plus", "Mutual Fund"));
        funds.add(new Fund("FXAIX", "Fidelity 500 Index Fund", "Mutual Fund"));
        funds.add(new Fund("VFIAX", "Vanguard 500 Index Fund Admiral Shares", "Mutual Fund"));
        funds.add(new Fund("VTSAX", "Vanguard Total Stock Market Index Fund Admiral Shares", "Mutual Fund"));
        funds.add(new Fund("VGTSX", "Vanguard Total International Stock Index Fund Investor", "Mutual Fund"));
        funds.add(new Fund("SWVXX", "Schwab Value Advantage Money Fund Investor", "Mutual Fund"));
        funds.add(new Fund("FGTXX", "Goldman Sachs FS Government Fund Institutional", "Mutual Fund"));
        funds.add(new Fund("FCTDX", "Fidelity Strategic Advisers Fidelity U.S. Total Stock Fund", "Mutual Fund"));
        funds.add(new Fund("VIIIX", "Vanguard Institutional Index Fund Institutional Plus", "Mutual Fund"));
        funds.add(new Fund("VTBNX", "Vanguard Total Bond Market II Index Fund Institutional", "Mutual Fund"));
        funds.add(new Fund("MVRXX", "Morgan Stanley Institutional Liquidity Government Portfolio Institutional", "Mutual Fund"));
        funds.add(new Fund("GVMXX", "State Street U.S. Government Money Market Fund Premier", "Mutual Fund"));
        funds.add(new Fund("AGTHX", "American Funds Growth Fund of America A", "Mutual Fund"));
        funds.add(new Fund("VTBIX", "Vanguard Total Bond Market II Index Fund Investor", "Mutual Fund"));
        funds.add(new Fund("FCNTX", "Fidelity Contrafund", "Mutual Fund"));
        funds.add(new Fund("SNAXX", "Schwab Value Advantage Money Fund Ultra", "Mutual Fund"));
        funds.add(new Fund("PIMIX", "PIMCO Income Fund Institutional", "Mutual Fund"));
        funds.add(new Fund("SPY", "SPDR S&P 500 ETF Trust", "ETF"));
        funds.add(new Fund("VOO", "Vanguard S&P 500 ETF", "ETF"));
        funds.add(new Fund("IVV", "iShares Core S&P 500 ETF", "ETF"));
        funds.add(new Fund("VTI", "Vanguard Total Stock Market ETF", "ETF"));
        funds.add(new Fund("QQQ", "Invesco QQQ Trust", "ETF"));
        funds.add(new Fund("VEA", "Vanguard FTSE Developed Markets ETF", "ETF"));
        funds.add(new Fund("VXUS", "Vanguard Total International Stock ETF", "ETF"));
        funds.add(new Fund("BND", "Vanguard Total Bond Market ETF", "ETF"));
        funds.add(new Fund("SCHD", "Schwab U.S. Dividend Equity ETF", "ETF"));
        funds.add(new Fund("DIA", "SPDR Dow Jones Industrial Average ETF Trust", "ETF"));
        funds.add(new Fund("IWM", "iShares Russell 2000 ETF", "ETF"));
        funds.add(new Fund("XLK", "Technology Select Sector SPDR Fund", "ETF"));
        FUNDS = Collections.unmodifiableList(funds);
    }

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/api/funds", new FundsHandler());
        server.createContext("/api/investment/future-value", new FutureValueHandler());
        server.createContext("/api/health", new HealthHandler());
        server.setExecutor(null);

        System.out.println("Investment Calculator backend listening on http://localhost:" + PORT);
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
                    .append("\"name\":\"").append(escapeJson(fund.name)).append("\",")
                    .append("\"category\":\"").append(escapeJson(fund.category)).append("\"}");
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
                sendError(exchange, 400, "Unsupported ticker. Use /api/funds to choose a supported investment.");
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
                double beta = fetchBetaFromNewton(ticker);
                double expectedReturnRate = fetchExpectedAnnualReturnFromYahoo(ticker);
                double capmRate = RISK_FREE_RATE + beta * (expectedReturnRate - RISK_FREE_RATE);
                double futureValue = principal * Math.pow(1.0 + capmRate, years);

                StringBuilder body = new StringBuilder();
                body.append("{")
                    .append("\"ticker\":\"").append(escapeJson(ticker)).append("\",")
                    .append("\"principal\":").append(round(principal, 2)).append(',')
                    .append("\"years\":").append(round(years, 2)).append(',')
                    .append("\"riskFreeRate\":").append(round(RISK_FREE_RATE, 6)).append(',')
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
        try {
            String endpoint = "https://api.newtonanalytics.com/stock-beta/?ticker=" +
                URLEncoder.encode(ticker, "UTF-8") +
                "&index=%5EGSPC&interval=1mo&observations=12";
            String response = httpGet(endpoint, 10000, 10000);
            if (response.contains("\"beta\"")) {
                return extractNumericField(response, "beta");
            }
            return extractNumericField(response, "data");
        } catch (IOException e) {
            throw new ExternalDataException("Newton API connection failed", e);
        }
    }

    private static double fetchExpectedAnnualReturnFromYahoo(String ticker) throws ExternalDataException {
        try {
            String endpoint = "https://query1.finance.yahoo.com/v8/finance/chart/" +
                URLEncoder.encode(ticker, "UTF-8") +
                "?range=1y&interval=1mo&events=history";
            String response = httpGet(endpoint, 10000, 10000);

            // Use average month-over-month return across the last year to better match
            // the challenge wording around historical average returns.
            List<Double> closes = extractCloseValues(response);
            if (closes.size() < 2) {
                throw new ExternalDataException("Insufficient close-price data from Yahoo Finance", null);
            }
            return calculateAverageHistoricalReturn(closes);
        } catch (IOException e) {
            throw new ExternalDataException("Yahoo Finance connection failed", e);
        }
    }

    private static double calculateAverageHistoricalReturn(List<Double> closes) throws ExternalDataException {
        double totalReturn = 0.0;
        int periods = 0;

        for (int i = 1; i < closes.size(); i++) {
            double previous = closes.get(i - 1);
            double current = closes.get(i);
            if (previous <= 0) {
                throw new ExternalDataException("Invalid close value from Yahoo Finance", null);
            }
            totalReturn += (current - previous) / previous;
            periods++;
        }

        if (periods == 0) {
            throw new ExternalDataException("Insufficient close-price periods from Yahoo Finance", null);
        }

        return totalReturn / periods;
    }

    private static String httpGet(String endpoint, int connectTimeoutMs, int readTimeoutMs) throws IOException, ExternalDataException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0");

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

    private static String readStream(InputStream stream) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
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
        private final String category;

        private Fund(String ticker, String name, String category) {
            this.ticker = ticker;
            this.name = name;
            this.category = category;
        }
    }

    private static class ExternalDataException extends Exception {
        private ExternalDataException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
