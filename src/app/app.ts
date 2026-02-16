import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './navbar/navbar';
import { RightSidebarComponent } from './right-sidebar/right-sidebar';
import { CanvasEditor } from './canvas-editor/canvas-editor';
import { BannerService } from './services/banner.service';
import { NotificationContainer } from './notification-container/notification-container';
import { MobileToolbarComponent } from './mobile-toolbar/mobile-toolbar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NavbarComponent, RightSidebarComponent, CanvasEditor, NotificationContainer, MobileToolbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class App {
  public bannerService = inject(BannerService);
  protected readonly title = signal('DesignHub');

  sidebarWidth = 350;
  isResizing = false;
  showMobileSidebar = signal(false);

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
      const newWidth = window.innerWidth - event.clientX;
      if (newWidth > 280 && newWidth < 800) {
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

    // Trigger canvas resize to maintain stability
    setTimeout(() => {
      this.bannerService.handleResize();
    }, 50);
  }

  resetSidebar() {
    this.sidebarWidth = 350;
    setTimeout(() => this.bannerService.handleResize(), 50);
  }

  toggleMobileSidebar() {
    this.showMobileSidebar.set(!this.showMobileSidebar());
  }

  closeMobileSidebar() {
    this.showMobileSidebar.set(false);
  }
}
