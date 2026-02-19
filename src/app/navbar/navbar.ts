import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BannerService } from '../services/banner.service';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NavbarComponent {
  public bannerService = inject(BannerService);
  private notificationService = inject(NotificationService);

  activeMenu: string | null = null;

  toggleMenu(menu: string) {
    this.activeMenu = this.activeMenu === menu ? null : menu;
  }

  closeMenus() {
    this.activeMenu = null;
  }

  /** Opens the Draw sidebar and activates brush drawing mode */
  openDrawSidebar() {
    this.bannerService.toggleEraser(false);          // turn off eraser
    this.bannerService.activeTab.set('draw');         // open sidebar draw tab
    this.bannerService.toggleDrawingMode(true);       // enable drawing mode
    this.closeMenus();
  }

  /** Opens the Draw sidebar and activates eraser mode */
  openEraserMode() {
    this.bannerService.toggleDrawingMode(false);      // turn off brush
    this.bannerService.activeTab.set('draw');         // open sidebar draw tab
    this.bannerService.toggleEraser(true);            // force eraser ON
    this.closeMenus();
  }


  utilUpdateBrushOpacity(event: Event) {
    const opacity = parseFloat((event.target as HTMLInputElement).value);
    this.bannerService.brushOpacity.set(opacity);
    this.bannerService.setBrushType(this.bannerService.brushType());
  }

  utilUpdateBrushSmoothing(event: Event) {
    const smoothing = parseInt((event.target as HTMLInputElement).value);
    this.bannerService.brushSmoothing.set(smoothing);
    this.bannerService.setBrushType(this.bannerService.brushType());
  }

  utilUpdateBrushSize(event: Event) {
    const size = parseInt((event.target as HTMLInputElement).value);
    this.bannerService.updateBrushSize(size);
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

  clearDrawings() {
    this.bannerService.clearDrawings();
  }

  setSelectMode() {
    this.bannerService.toggleDrawingMode(false);
    this.bannerService.toggleEraser(false);
    // Close the draw sidebar if it was open
    if (this.bannerService.activeTab() === 'draw') {
      this.bannerService.activeTab.set('');
    }
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
        // Use true as the 3rd argument to force creating a new template instead of overwriting
        await this.bannerService.saveTemplate(name, 'Template', true);
        this.notificationService.success('Template saved to library!');
        this.closeMenus();
      }
    });
  }

  async saveAsDesign() {
    this.notificationService.prompt('Save as Design', 'Enter design name:', 'My Design', async (name) => {
      if (name) {
        await this.bannerService.saveTemplate(name, 'Design', true);
        this.notificationService.success('Design saved to library!');
        this.closeMenus();
      }
    });
  }

  async saveAsBackground() {
    this.notificationService.prompt('Save Background', 'Enter background name:', 'My Background', async (name) => {
      if (name) {
        await this.bannerService.saveTemplate(name, 'Background', true);
        this.notificationService.success('Background saved to library!');
        this.closeMenus();
      }
    });
  }

  /**
   * Export all saved templates/designs/backgrounds as a portable JSON file.
   * That file can be placed in public/ready_made_templates.json and redeployed
   * so every new visitor sees the items automatically.
   */
  async exportLibrary() {
    this.closeMenus();
    await this.bannerService.exportLibraryToJSON();
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
