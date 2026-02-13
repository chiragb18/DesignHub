import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BannerService } from '../services/banner.service';

@Component({
  selector: 'app-mobile-toolbar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mobile-toolbar">
      <button [class.active]="bannerService.activeTab() === 'templates'" (click)="setTab('templates')">
        <span class="material-symbols-outlined">grid_view</span>
        <label>Templates</label>
      </button>
      <button [class.active]="bannerService.activeTab() === 'text'" (click)="setTab('text')">
        <span class="material-symbols-outlined">title</span>
        <label>Text</label>
      </button>
      <button [class.active]="bannerService.activeTab() === 'elements'" (click)="setTab('elements')">
        <span class="material-symbols-outlined">auto_awesome_motion</span>
        <label>Elements</label>
      </button>
      <button [class.active]="bannerService.activeTab() === 'background'" (click)="setTab('background')">
        <span class="material-symbols-outlined">palette</span>
        <label>BG</label>
      </button>
      <button [class.active]="bannerService.activeTab() === 'layers'" (click)="setTab('layers')">
        <span class="material-symbols-outlined">layers</span>
        <label>Layers</label>
      </button>
    </div>
  `,
  styles: [`
    .mobile-toolbar {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 64px;
      background: #ffffff;
      display: flex;
      justify-content: space-around;
      align-items: center;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
      z-index: 1000;
      padding-bottom: env(safe-area-inset-bottom);
    }
    button {
      flex: 1;
      height: 100%;
      border: none;
      background: transparent;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: #64748b;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 44px;
    }
    button.active {
      color: #7c3aed;
    }
    .material-symbols-outlined {
      font-size: 24px;
    }
    label {
      font-size: 10px;
      font-weight: 500;
      pointer-events: none;
    }
  `]
})
export class MobileToolbarComponent {
  public bannerService = inject(BannerService);

  setTab(tab: string) {
    this.bannerService.activeTab.set(tab);
    // On mobile, selecting a tab should also probably open the bottom sheet if we implement it that way
  }
}
