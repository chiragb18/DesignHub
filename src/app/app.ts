import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './navbar/navbar';
import { RightSidebarComponent } from './right-sidebar/right-sidebar';
import { CanvasEditor } from './canvas-editor/canvas-editor';
import { BannerService } from './services/banner.service';
import { NotificationContainer } from './notification-container/notification-container';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NavbarComponent, RightSidebarComponent, CanvasEditor, NotificationContainer],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  public bannerService = inject(BannerService);
  protected readonly title = signal('BannerStudio');

  sidebarWidth = 350;
  isResizing = false;

  private onMouseMove = (event: MouseEvent) => this.onResizing(event);
  private onMouseUp = () => this.stopResizing();

  startResizing(event: MouseEvent) {
    this.isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    event.preventDefault();
  }

  onResizing(event: MouseEvent) {
    if (this.isResizing) {
      const newWidth = event.clientX;
      if (newWidth > 280 && newWidth < 600) {
        this.sidebarWidth = newWidth;
      }
    }
  }

  stopResizing() {
    this.isResizing = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
  }

  resetSidebar() {
    this.sidebarWidth = 280;
  }
}
