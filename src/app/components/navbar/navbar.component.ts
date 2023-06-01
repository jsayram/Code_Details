import { Component, OnDestroy, OnInit ,ViewChild} from '@angular/core';

import { ModalService } from '../modal-w';

import { BreakpointObserver } from '@angular/cdk/layout';
import { MatSidenav } from '@angular/material/sidenav';
import { delay, filter, takeUntil } from 'rxjs/operators';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['../../../styles/components/navbar.component.scss']
})
export class NavbarComponent implements OnInit, OnDestroy {
  @ViewChild(MatSidenav)
  sidenav!: MatSidenav;
  sidenav2!: MatSidenav;

  destroyed$ = new Subject<void>();

  constructor(private observer: BreakpointObserver,
              private router: Router, 
              private modalService: ModalService) {}

  ngAfterViewInit() {
    this.observeSidenav();
   // this.observeRouter();
  }
  ngOnInit(): void { 
  }

  ngOnDestroy() {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

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