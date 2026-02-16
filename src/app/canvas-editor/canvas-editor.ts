import { Component, AfterViewInit, inject, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { BannerService } from '../services/banner.service';
import { CommonModule } from '@angular/common';
import * as fabric from 'fabric';

@Component({
  selector: 'app-canvas-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './canvas-editor.html',
  styleUrl: './canvas-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CanvasEditor implements AfterViewInit {
  public bannerService = inject(BannerService);

  // Expose signals for template
  selectedObject = this.bannerService.selectedObject;
  zoomLevel = this.bannerService.zoomLevel;

  ngAfterViewInit(): void {
    // Initialize the canvas through the shared service
    this.bannerService.initCanvas('editorCanvas');

    // Initial welcome text - Removed as requested
    // this.bannerService.addText('Banner Studio');
  }

  zoomIn() {
    this.bannerService.zoomIn();
  }

  zoomOut() {
    this.bannerService.zoomOut();
  }

  resetZoom() {
    this.bannerService.setZoom(1);
  }

  undo() {
    this.bannerService.undo();
  }

  redo() {
    this.bannerService.redo();
  }

  deleteSelected() {
    this.bannerService.deleteSelected();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey) {
      switch (event.key.toLowerCase()) {
        case 'z':
          event.preventDefault();
          this.bannerService.undo();
          break;
        case 'y':
          event.preventDefault();
          this.bannerService.redo();
          break;
        case 'c':
          this.bannerService.copy();
          break;
        case 'v':
          this.bannerService.paste();
          break;
        case 's':
          event.preventDefault();
          this.bannerService.exportToImage('png');
          break;
      }
    } else {
      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          // Only delete if we're not typing in a text box
          const canvas = (this.bannerService as any).canvas;
          const activeObj = canvas?.getActiveObject();
          if (activeObj && (activeObj.type !== 'textbox' || !activeObj.isEditing)) {
            this.bannerService.deleteSelected();
          }
          break;
      }
    }
  }
}
