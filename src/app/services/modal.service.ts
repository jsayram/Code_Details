import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ModalService {
    private modals: any[] = [];

    /**
     * Add a modal to the array of active modals.
     * @param modal - The modal to be added.
     */
    add(modal: any) {
        this.modals.push(modal);
    }
    
    /**
     * Remove a modal from the array of active modals.
     * @param id - The ID of the modal to be removed.
     */
    remove(id: string) {
        this.modals = this.modals.filter(modal => modal.id !== id);
    }

    /**
     * Open a modal specified by its ID.
     * @param id - The ID of the modal to be opened.
     */
    open(id: string) {
        const modal = this.modals.find(modal => modal.id === id);
        if (modal) {
            modal.open();
        }
    }

    /**
     * Close a modal specified by its ID.
     * @param id - The ID of the modal to be closed.
     */
    close(id: string) {
        const modal = this.modals.find(modal => modal.id === id);
        if (modal) {
            modal.close();
        }
    }
}
