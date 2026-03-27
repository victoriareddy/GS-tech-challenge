import { Routes } from '@angular/router';
import { CalculatorPageComponent } from './pages/calculator-page.component';
import { ChatPageComponent } from './pages/chat-page.component';

export const routes: Routes = [
  { path: '', component: CalculatorPageComponent },
  { path: 'chat', component: ChatPageComponent },
  { path: '**', redirectTo: '' }
];
