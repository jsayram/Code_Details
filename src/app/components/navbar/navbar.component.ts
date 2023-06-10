import { ChangeDetectorRef, Component, OnDestroy, OnInit ,ViewChild} from '@angular/core';

import { ModalService } from '../modal-w';

import { BreakpointObserver } from '@angular/cdk/layout';
import { MatSidenav } from '@angular/material/sidenav';
import { delay, filter, takeUntil } from 'rxjs/operators';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';

import { faFacebookF, faTwitter, faInstagram, faLinkedinIn } from '@fortawesome/free-brands-svg-icons';




@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit, OnDestroy {
  
icons = {
  faFacebookF,
  faTwitter,
  faInstagram,
  faLinkedinIn
};

  @ViewChild(MatSidenav)
  sidenav!: MatSidenav;
  sidenav2!: MatSidenav;

  destroyed$ = new Subject<void>();

  constructor(private observer: BreakpointObserver,
              private router: Router, 
              private modalService: ModalService,
              private cd: ChangeDetectorRef) {}

  ngAfterViewInit() {
    // this is the first time sidenav is actually rendered in the DOM so we can use it safely here
    this.observeSidenav();

    //change detection to avoid ExpressionChangedAfterItHasBeenCheckedError error in console log beccause of sidenav mode change
    this.cd.detectChanges();
  }
  ngOnInit(): void {  
  }

  ngOnDestroy() {

    // this is needed to avoid memory leaks because sidenav is a global object and it would stay in memory even after component is destroyed
    this.destroyed$.next();
    // this is needed to complete the subject and avoid memory leaks because sidenav is a global object and it would stay in memory even after component is destroyed
    this.destroyed$.complete();
  }

  //this is needed to observe the sidenav and change its mode based on the screen size (over or side), it is also needed to close the sidenav when the router changes (only in mobile mode)
  observeSidenav() {
    this.observer.observe(['(max-width: 760px)']).pipe(
      filter((res: any) => res.matches),
      takeUntil(this.destroyed$)
    ).subscribe(() => {
      this.sidenav.mode = 'over';
      this.sidenav.close();
    });

    this.observer.observe(['(min-width: 761px)']).pipe(
      filter((res: any) => res.matches),
      takeUntil(this.destroyed$)
    ).subscribe(() => {
      this.sidenav.mode = 'side';
      this.sidenav.open();
    });
  }
  // observeRouter() {
  //   this.router.events.pipe(
  //     filter(event => event instanceof NavigationEnd),
  //     takeUntil(this.destroyed$)
  //   ).subscribe(() => {
  //     if (this.sidenav.mode === 'over') {
  //       this.sidenav.close();
  //     }
  //   });
  // }

  OpenModal(id: string) {
    console.log("Open Modal Nav Bar ID = "+ id);
    this.modalService.open(id);
  }

  CloseModal(id: string) {
    console.log("Close Modal Nav Bar ID = "+ id);
    this.modalService.close(id);
  }





}