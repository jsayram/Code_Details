import { Component, ViewEncapsulation, ElementRef, Input, OnInit, OnDestroy } from '@angular/core';
import { Console } from 'console';

import { ModalService } from '../services/modal.service';

@Component({ 
    selector: 'jw-modal', 
    templateUrl: 'modal-w.component.html', 
    styleUrls: ['modal-w.component.less'],
    encapsulation: ViewEncapsulation.None
})
export class ModalWComponent implements OnInit, OnDestroy {
    @Input() id?: any;
    private element: any;

    constructor(private modalService: ModalService, private el: ElementRef) {
        this.element = el.nativeElement;
    }

    ngOnInit(): void {
        // ensure id attribute exists
        console.log("Inside the modal-w.component.ts, where we check the id----"+ this.id );
        if (!this.id) {
            console.error('modal must have an id');
            return;
        }

        // move element to bottom of page (just before </body>) so it can be displayed above everything else
        document.body.appendChild(this.element);

        // close modal on background click
        this.element.addEventListener('click', (el: { target: { className: string; }; }) => {
            if (el.target.className === 'jw-modal') {
                this.close();
                console.log("ClOSING THIS MODAL");
                
        
                // var stopVideos = function () {
                //     var videos = document.querySelectorAll('iframe, video');
                //     Array.prototype.forEach.call(videos, function (video) {
                //         if (video.tagName.toLowerCase() === 'video') {
                //             video.pause();
                            
                //         } else {
                //             var src = video.src;
                //             video.src = src;
                //         } 
                //     }); 
                // };
                // console.log("ClOSING THIS MODALX2");
            }
        });

        // add self (this modal instance) to the modal service so it's accessible from controllers
        this.modalService.add(this);
    }
    
    // remove self from modal service when component is destroyed
    ngOnDestroy(): void {
        this.modalService.remove(this.id);
        this.element.remove();
    }

    // open modal
    open(): void {
        this.element.style.display = 'block';
        document.body.classList.add('jw-modal-open');
    }

    // close modal
    closeOnBackgroundClick(): void {
        this.element.style.display = 'none';
        document.body.classList.remove('jw-modal-open'); 
    }
    
    close(): void {
        this.element.style.display = 'none';
        const stopVideos = () => {
        document.querySelectorAll('iframe').forEach(v => { v.src = v.src });
        document.querySelectorAll('video').forEach(v => { v.pause() });
        };
        stopVideos();
        document.body.classList.remove('jw-modal-open');
    }
}
