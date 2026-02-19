import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BannerService } from '../services/banner.service';

@Component({
  selector: 'app-mobile-toolbar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mobile-toolbar-wrapper">
      <div class="mobile-toolbar">
        <button [class.active]="bannerService.activeTab() === 'templates'" (click)="setTab('templates')">
          <span class="material-symbols-outlined">grid_view</span>
          <label>Templates</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'text'" (click)="setTab('text')">
          <span class="material-symbols-outlined">title</span>
          <label>Text</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'draw'" (click)="setTab('draw')">
          <span class="material-symbols-outlined">gesture</span>
          <label>Draw</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'elements'" (click)="setTab('elements')">
          <span class="material-symbols-outlined">auto_awesome_motion</span>
          <label>Elements</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'cutouts'" (click)="setTab('cutouts')">
          <span class="material-symbols-outlined">content_cut</span>
          <label>Cutouts</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'filters'" (click)="setTab('filters')">
          <span class="material-symbols-outlined">magic_button</span>
          <label>Filters</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'background'" (click)="setTab('background')">
          <span class="material-symbols-outlined">palette</span>
          <label>BG</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'layers'" (click)="setTab('layers')">
          <span class="material-symbols-outlined">layers</span>
          <label>Layers</label>
        </button>
        <button [class.active]="bannerService.activeTab() === 'projects'" (click)="setTab('projects')">
          <span class="material-symbols-outlined">folder</span>
          <label>Folders</label>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .mobile-toolbar-wrapper {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      background: #ffffff;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
      z-index: 1000;
      /* Respect iPhone home indicator / safe area */
      padding-bottom: env(safe-area-inset-bottom, 0px);
      border-top: 1px solid #f1f5f9;
    }
    .mobile-toolbar {
      display: flex;
      align-items: center;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
      padding: 0 12px;
      height: 72px;
      gap: 8px;
      
      /* Hide scrollbar */
      scrollbar-width: none;
      -ms-overflow-style: none;
      &::-webkit-scrollbar { display: none; }
    }
    button {
      flex: 0 0 auto;
      width: 64px;
      height: 56px;
      border: 1px solid #f1f5f9;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      color: #64748b;
      cursor: pointer;
      border-radius: 12px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 56px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
      /* min touch target size: 44x44 per HIG */
      min-height: 44px;
      -webkit-tap-highlight-color: transparent;

      &:active {
        background: #f8fafc;
        transform: scale(0.94);
        box-shadow: 0 1px 2px rgba(0,0,0,0.01);
      }
    }
    button.active {
      color: #7c3aed;
      background: #ede9fe;
      border-color: #ddd6fe;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.1);
      
      .material-symbols-outlined {
        font-variation-settings: 'FILL' 1;
        transform: translateY(-1px);
      }
      label {
        font-weight: 700;
      }
    }
    .material-symbols-outlined {
      font-size: 22px;
      transition: transform 0.2s ease;
    }
    label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      pointer-events: none;
      white-space: nowrap;
    }

    /* Small Phone: < 480px */
    @media (max-width: 479px) {
      .mobile-toolbar {
        height: 68px;
        padding: 0 8px;
        gap: 6px;
      }
      button {
        width: 58px;
        height: 52px;
        min-width: 50px;
        border-radius: 10px;
      }
      .material-symbols-outlined {
        font-size: 21px;
      }
      label {
        font-size: 8.5px;
      }
    }

    /* Very small phones: < 360px */
    @media (max-width: 359px) {
      .mobile-toolbar {
        height: 64px;
        padding: 0 6px;
        gap: 4px;
      }
      button {
        width: 54px;
        height: 48px;
        min-width: 46px;
        border-radius: 9px;
      }
      .material-symbols-outlined {
        font-size: 20px;
      }
      label {
        font-size: 8px;
        letter-spacing: 0.3px;
      }
    }
  `]
})
export class MobileToolbarComponent {
  public bannerService = inject(BannerService);

  setTab(tab: string) {
    if (this.bannerService.activeTab() === tab) {
      this.bannerService.activeTab.set('');
    } else {
      this.bannerService.activeTab.set(tab);
    }
  }
}
