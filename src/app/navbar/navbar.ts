import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BannerService } from '../services/banner.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss'
})
export class NavbarComponent {
  public bannerService = inject(BannerService);

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
      alert('Changes saved successfully!');
    } else {
      // New project, ask for name
      const name = prompt('Enter design name:', 'Untitled Design');
      if (name) {
        await this.bannerService.saveProject(name);
        this.bannerService.activeTab.set('projects');
        alert('Project saved successfully! You can find it in the "Projects" tab.');
      }
    }
  }

  startNewDesign() {
    if (confirm('Create a new design? Current unsaved changes might be lost.')) {
      this.bannerService.clearCanvas();
      this.bannerService.activeProjectId.set(null);
    }
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

  get selectedObject() {
    return this.bannerService.selectedObject();
  }
}
