import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationService } from '../services/notification.service';

@Component({
    selector: 'app-notification-container',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './notification-container.html',
    styleUrl: './notification-container.scss'
})
export class NotificationContainer {
    public notificationService = inject(NotificationService);

    onConfirm() {
        const modal = this.notificationService.activeModal();
        if (modal) {
            modal.onConfirm(modal.inputValue);
        }
    }

    onCancel() {
        const modal = this.notificationService.activeModal();
        if (modal && modal.onCancel) {
            modal.onCancel();
        } else {
            this.notificationService.closeModal();
        }
    }
}
