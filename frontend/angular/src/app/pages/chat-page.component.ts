import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ApiService, ChatMessage } from '../services/api.service';

interface RenderedMessage {
  role: 'user' | 'bot';
  html: SafeHtml;
}

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css'
})
export class ChatPageComponent {
  @ViewChild('chatWindow') chatWindow?: ElementRef<HTMLElement>;
  @ViewChild('userInput') userInputRef?: ElementRef<HTMLTextAreaElement>;

  inputText = '';
  isSending = false;
  showEmptyState = true;
  typing = false;

  readonly suggestions = [
    'What is a mutual fund?',
    'Index funds vs actively managed funds',
    'How do expense ratios work?',
    'Best funds for long-term growth?',
    'What is NAV?',
    'How to diversify a portfolio?',
    'SIP vs lump sum investing',
    'Tax implications of mutual funds'
  ];

  messages: RenderedMessage[] = [];
  history: ChatMessage[] = [];

  constructor(
    private readonly apiService: ApiService,
    private readonly sanitizer: DomSanitizer
  ) {}

  onSuggestion(text: string): void {
    this.inputText = text;
    void this.sendMessage();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  autoResize(): void {
    const el = this.userInputRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  async sendMessage(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.isSending) return;

    this.showEmptyState = false;
    this.pushMessage('user', text);
    this.history.push({ role: 'user', content: text });

    this.inputText = '';
    this.autoResize();
    this.isSending = true;
    this.typing = true;

    try {
      const data = await this.apiService.sendChat(this.history);
      const reply = data.reply || 'No response received.';
      this.pushMessage('bot', reply);
      this.history.push({ role: 'assistant', content: reply });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Server error';
      this.pushMessage('bot', `⚠️ ${message}. Please check the server is running.`);
    } finally {
      this.typing = false;
      this.isSending = false;
      this.userInputRef?.nativeElement.focus();
    }
  }

  private pushMessage(role: 'user' | 'bot', text: string): void {
    const html = this.sanitizer.bypassSecurityTrustHtml(this.formatText(text));
    this.messages.push({ role, html });
    setTimeout(() => {
      if (this.chatWindow?.nativeElement) {
        this.chatWindow.nativeElement.scrollTop = this.chatWindow.nativeElement.scrollHeight;
      }
    });
  }

  private formatText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:4px;font-size:0.87em">$1</code>')
      .replace(/^### (.+)$/gm, '<strong style="font-size:1em;color:var(--gold)">$1</strong>')
      .replace(/^## (.+)$/gm, '<strong style="font-size:1.05em;color:var(--accent2)">$1</strong>')
      .replace(/^\s*[-•] (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n/g, '<br/>');
  }
}
