import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BannerService } from '../services/banner.service';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss'
})
export class NavbarComponent {
  public bannerService = inject(BannerService);
  private notificationService = inject(NotificationService);

  activeMenu: string | null = null;

  // Canvas Size UI State
  canvasWidth = 1080;
  canvasHeight = 1080;
  lockRatio = true;

  presets = [
    { name: 'Mobile', width: 1080, height: 1920, icon: 'smartphone' },
    { name: 'Tablet', width: 1536, height: 2048, icon: 'tablet_mac' },
    { name: 'Desktop', width: 1920, height: 1080, icon: 'desktop_windows' },
    { name: 'Square', width: 1080, height: 1080, icon: 'square' },
    { name: 'Story', width: 1080, height: 1920, icon: 'ad_units' },
    { name: 'Banner', width: 1200, height: 628, icon: 'crop_landscape' }
  ];

  setCanvasSize(w: number, h: number) {
    this.canvasWidth = w;
    this.canvasHeight = h;
    this.bannerService.resizeCanvas(w, h);
    this.closeMenus();
  }

  toggleLock() {
    this.lockRatio = !this.lockRatio;
  }

  updateCustomWidth(val: number) {
    if (this.lockRatio) {
      const ratio = this.canvasHeight / this.canvasWidth;
      this.canvasHeight = Math.round(val * ratio);
    }
    this.canvasWidth = val;
  }

  updateCustomHeight(val: number) {
    if (this.lockRatio) {
      const ratio = this.canvasWidth / this.canvasHeight;
      this.canvasWidth = Math.round(val * ratio);
    }
    this.canvasHeight = val;
  }

  applyCustomSize() {
    this.bannerService.resizeCanvas(this.canvasWidth, this.canvasHeight);
    this.closeMenus();
  }

  toggleMenu(menu: string) {
    this.activeMenu = this.activeMenu === menu ? null : menu;
  }

  closeMenus() {
    this.activeMenu = null;
  }

  selectBrush(type: 'pencil' | 'spray' | 'circle' | 'highlighter' | 'dotted') {
    this.bannerService.setBrushType(type);
    if (!this.bannerService.isDrawingMode()) {
      this.bannerService.toggleDrawingMode(true);
    }
    this.closeMenus();
  }

  utilUpdateBrushColor(event: any) {
    this.bannerService.updateBrushColor(event.target.value);
  }

  addText() {
    this.bannerService.addText();
  }

  triggerUpload() {
    const fileInput = document.getElementById('imageUpload') as HTMLInputElement;
    fileInput.click();
  }

  uploadImage(event: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.bannerService.addImage(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }

  addSquare() { this.bannerService.addShape('square'); }
  addRect() { this.bannerService.addShape('rect'); }
  addCircle() { this.bannerService.addShape('circle'); }
  addTriangle() { this.bannerService.addShape('triangle'); }
  addHexagon() { this.bannerService.addShape('hexagon'); }
  addPentagon() { this.bannerService.addShape('pentagon'); }
  addOctagon() { this.bannerService.addShape('octagon'); }
  addStar() { this.bannerService.addShape('star'); }
  addHeart() { this.bannerService.addShape('heart'); }
  addArrow() { this.bannerService.addShape('arrow'); }
  addCloud() { this.bannerService.addShape('cloud'); }

  toggleDrawingMode() {
    this.bannerService.toggleDrawingMode();
  }

  toggleEraser() {
    this.bannerService.toggleEraser();
  }

  setSelectMode() {
    this.bannerService.toggleDrawingMode(false);
    this.bannerService.toggleEraser(false);
  }

  undo() { this.bannerService.undo(); }
  redo() { this.bannerService.redo(); }

  async saveProject() {
    const activeId = this.bannerService.activeProjectId();

    if (activeId) {
      // Already has a project open, just save
      await this.bannerService.saveProject();
      this.notificationService.success('Changes saved successfully!');
      this.closeMenus();
    } else {
      // New project, ask for name
      this.notificationService.prompt(
        'Save Design',
        'Enter a name for your design:',
        'Untitled Design',
        async (name) => {
          if (name) {
            await this.bannerService.saveProject(name);
            this.bannerService.activeTab.set('projects');
            this.notificationService.success('Project saved successfully!');
          }
        }
      );
    }
  }

  startNewDesign() {
    this.notificationService.confirm(
      'New Design',
      'Create a new design? Current unsaved changes will be lost.',
      () => {
        this.bannerService.clearCanvas();
        this.bannerService.activeProjectId.set(null);
        this.notificationService.info('Started a new design');
      }
    );
  }

  downloadPNG() {
    this.bannerService.exportToImage('png');
  }

  // Crop Functionality
  startCrop() {
    this.bannerService.cropSelection();
  }

  applyCrop() {
    this.bannerService.applyCrop();
  }

  cancelCrop() {
    this.bannerService.cancelCrop();
  }

  get isCropping() {
    return this.bannerService.isCropping();
  }

  async saveAsTemplate() {
    this.notificationService.prompt('Save as Template', 'Enter template name:', 'My Template', async (name) => {
      if (name) {
        await this.bannerService.saveTemplate(name, 'Template');
        this.notificationService.success('Template saved to library!');
        this.closeMenus();
      }
    });
  }

  async saveAsDesign() {
    this.notificationService.prompt('Save as Design', 'Enter design name:', 'My Design', async (name) => {
      if (name) {
        await this.bannerService.saveTemplate(name, 'Design');
        this.notificationService.success('Design saved to library!');
        this.closeMenus();
      }
    });
  }

  async saveAsBackground() {
    this.notificationService.prompt('Save Background', 'Enter background name:', 'My Background', async (name) => {
      if (name) {
        await this.bannerService.saveTemplate(name, 'Background');
        this.notificationService.success('Background saved to library!');
        this.closeMenus();
      }
    });
  }

  toggleLanguage(lang: 'en' | 'mr') {
    this.bannerService.typingLanguage.set(lang);
  }

  get currentLanguage() {
    return this.bannerService.typingLanguage();
  }

  get selectedObject() {
    return this.bannerService.selectedObject();
  }
}
