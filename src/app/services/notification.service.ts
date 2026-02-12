import { Injectable, signal } from '@angular/core';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
    id: string;
    message: string;
    type: NotificationType;
    duration?: number;
}

export interface ModalOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    showInput?: boolean;
    inputValue?: string;
    onConfirm: (value?: string) => void;
    onCancel?: () => void;
}

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    public toasts = signal<Toast[]>([]);
    public activeModal = signal<ModalOptions | null>(null);
    private toastCounter = 0; // Counter to ensure unique IDs

    showToast(message: string, type: NotificationType = 'info', duration: number = 3000) {
        const id = `${Date.now()}-${this.toastCounter++}`;
        const newToast: Toast = { id, message, type, duration };

        this.toasts.update(current => [...current, newToast]);

        if (duration > 0) {
            setTimeout(() => {
                this.removeToast(id);
            }, duration);
        }
    }

    removeToast(id: string) {
        this.toasts.update(current => current.filter(t => t.id !== id));
    }

    success(message: string) {
        this.showToast(message, 'success');
    }

    error(message: string) {
        this.showToast(message, 'error');
    }

    info(message: string) {
        this.showToast(message, 'info');
    }

    warning(message: string) {
        this.showToast(message, 'warning');
    }

    confirm(title: string, message: string, onConfirm: () => void, onCancel?: () => void) {
        this.activeModal.set({
            title,
            message,
            onConfirm: () => {
                this.activeModal.set(null);
                onConfirm();
            },
            onCancel: () => {
                this.activeModal.set(null);
                if (onCancel) onCancel();
            }
        });
    }

    prompt(title: string, message: string, defaultValue: string, onConfirm: (value: string) => void, onCancel?: () => void) {
        this.activeModal.set({
            title,
            message,
            showInput: true,
            inputValue: defaultValue,
            onConfirm: (value) => {
                this.activeModal.set(null);
                onConfirm(value || '');
            },
            onCancel: () => {
                this.activeModal.set(null);
                if (onCancel) onCancel();
            }
        });
    }

    closeModal() {
        this.activeModal.set(null);
    }
}
