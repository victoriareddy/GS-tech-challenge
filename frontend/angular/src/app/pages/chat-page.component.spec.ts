import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ChatPageComponent } from './chat-page.component';
import { ApiService } from '../services/api.service';
import { vi } from 'vitest';

describe('ChatPageComponent', () => {
  let fixture: ComponentFixture<ChatPageComponent>;
  let component: ChatPageComponent;

  const sendChat = vi.fn(async (history: { role: string; content: string }[]) => {
    expect(history.length).toBe(1);
    expect(history[0]).toEqual({ role: 'user', content: 'What is NAV?' });
    return { reply: '**Hello** from advisor' };
  });
  const getFunds = vi.fn();
  const getFutureValue = vi.fn();

  beforeEach(async () => {
    sendChat.mockClear();

    await TestBed.configureTestingModule({
      imports: [ChatPageComponent, RouterTestingModule],
    })
      .overrideProvider(ApiService, {
        useValue: { getFunds, getFutureValue, sendChat },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ChatPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not send empty message', async () => {
    component.inputText = '   ';
    await component.sendMessage();
    expect(sendChat).not.toHaveBeenCalled();
  });

  it('should append user and bot messages after API reply', async () => {
    component.inputText = 'What is NAV?';
    await component.sendMessage();
    expect(component.showEmptyState).toBe(false);
    expect(component.messages.length).toBe(2);
    expect(component.messages[0].role).toBe('user');
    expect(component.messages[1].role).toBe('bot');
    expect(sendChat).toHaveBeenCalled();
  });

  it('should have suggestion chips', () => {
    expect(component.suggestions.length).toBeGreaterThan(0);
  });
});
