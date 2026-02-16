import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BannerService, Template } from '../services/banner.service';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { NotificationService } from '../services/notification.service';

@Component({
    selector: 'app-templates-panel',
    standalone: true,
    imports: [CommonModule, MatIconModule, FormsModule],
    templateUrl: './templates-panel.html',
    styleUrl: './templates-panel.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class TemplatesPanel {
    public bannerService = inject(BannerService);
    private notificationService = inject(NotificationService);

    searchQuery = signal('');
    selectedCategory = signal('All');
    showSaveSuccess = signal(false);

    // Background Presets
    colors = [
        '#ffffff', '#000000', '#f3f4f6', '#9ca3af', '#78716c', '#1e293b',
        '#e11d48', '#db2777', '#c026d3', '#9333ea', '#7c3aed', '#4f46e5',
        '#3b82f6', '#2563eb', '#0891b2', '#06b6d4', '#059669', '#10b981',
        '#65a30d', '#f59e0b', '#d97706', '#ea580c', '#ef4444'
    ];

    gradients = [
        { css: 'linear-gradient(to right, #ff7e5f, #feb47b)', c1: '#ff7e5f', c2: '#feb47b' },
        { css: 'linear-gradient(to right, #4facfe, #00f2fe)', c1: '#4facfe', c2: '#00f2fe' },
        { css: 'linear-gradient(to right, #43e97b, #38f9d7)', c1: '#43e97b', c2: '#38f9d7' },
        { css: 'linear-gradient(to right, #fa709a, #fee140)', c1: '#fa709a', c2: '#fee140' },
        { css: 'linear-gradient(to right, #667eea, #764ba2)', c1: '#667eea', c2: '#764ba2' },
        { css: 'linear-gradient(to right, #89f7fe, #66a6ff)', c1: '#89f7fe', c2: '#66a6ff' },
    ];

    patterns = ['dots', 'dots-large', 'stripes', 'grid', 'checkerboard', 'diagonal', 'waves'];

    mockTemplates: Template[] = [];

    // Background Actions
    setSolidBg(color: string) {
        this.bannerService.setCanvasBg(color);
    }

    setGradientBg(g: any) {
        this.bannerService.setGradientBg(g.c1, g.c2);
    }

    setPatternBg(p: string) {
        this.bannerService.setPatternBg(p);
    }

    uploadBg(event: any) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e: any) => {
                this.bannerService.setAntiGravityBg(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    }

    onColorChange(event: any) {
        this.setSolidBg(event.target.value);
    }


    openSaveModal(category: string = 'Template') {
        let defaultName = 'Untitled ' + category;
        const activeId = this.bannerService.activeTemplateId();
        const activeTemplate = this.bannerService.savedTemplates().find(t => t.id === activeId);

        if (activeTemplate && activeTemplate.isCustom) {
            defaultName = activeTemplate.name;
        }

        this.notificationService.prompt(
            `Save as ${category}`,
            `Enter a name for your ${category.toLowerCase()}:`,
            defaultName,
            async (name) => {
                if (name) {
                    const success = await this.bannerService.saveTemplate(name, category);
                    if (success) {
                        this.notificationService.success(`${category} saved successfully!`);
                    }
                }
            }
        );
    }

    // New specific save actions
    saveAsBackground() {
        this.openSaveModal('Background');
    }

    saveAsDesign() {
        this.openSaveModal('Design');
    }

    saveAsTemplate() {
        this.openSaveModal('Template');
    }

    // Replaces saveAsTemplate / addToTemplate logic
    initiateSave() {
        this.openSaveModal('Template');
    }

    // Signals for specific lists
    filteredTemplates = computed(() => {
        const query = this.searchQuery().toLowerCase();
        return this.bannerService.savedTemplates().filter(t => t.name.toLowerCase().includes(query));
    });

    filteredDesigns = computed(() => {
        const query = this.searchQuery().toLowerCase();
        return this.bannerService.savedDesigns().filter(t => t.name.toLowerCase().includes(query));
    });

    filteredBackgrounds = computed(() => {
        const query = this.searchQuery().toLowerCase();
        return this.bannerService.savedBackgrounds().filter(t => t.name.toLowerCase().includes(query));
    });

    // Load vs Append
    applyTemplate(template: Template) {
        this.notificationService.confirm(
            'Load Template',
            'Replace current design with this? Unsaved changes will be lost.',
            () => {
                this.bannerService.activeTemplateId.set(template.isCustom ? template.id : null);
                // Pass the entire template object, not template.json (which is null in shadow storage)
                this.bannerService.loadTemplate(template);
                this.notificationService.info('Template loaded');
            }
        );
    }

    addToCanvas(template: Template) {
        console.log('Add to canvas clicked:', template);
        // Pass the entire template object, not template.json (which is null in shadow storage)
        this.bannerService.addTemplateToCanvas(template);
    }

    async deleteTemplate(event: Event, template: Template) {
        event.stopPropagation();
        this.notificationService.confirm(
            'Delete Item',
            `Are you sure you want to delete "${template.name}"? This action cannot be undone.`,
            async () => {
                await this.bannerService.deleteTemplate(template.id);
                this.notificationService.success('Item deleted');
            }
        );
    }
}