import { Component, OnInit, AfterViewInit } from '@angular/core';
import * as ScrollMagic from 'scrollmagic';
import { animationTriggers} from '../../animations/animations';  // import the MY custom animation triggers

@Component({
  selector: 'app-home-page',
  templateUrl: './home-page.component.html',
  styleUrls: ['../../../styles/components/home-page.component.scss'],
  animations: [...Object.values(animationTriggers)],
})


export class HomePageComponent implements OnInit, AfterViewInit {
  controller: ScrollMagic.Controller;

  constructor() { 
    this.controller = new ScrollMagic.Controller();
  }

  ngOnInit(): void {
  }

  ngAfterViewInit(): void {
    // Scene 1
    new ScrollMagic.Scene({
      triggerElement: '#trigger1',
      duration: '100%',
      reverse: true,
    })
      .setClassToggle('#reveal1', 'visible')
      .addTo(this.controller);

    // Scene 2
    new ScrollMagic.Scene({
      triggerElement: '#trigger2',
      triggerHook: 0.1,
      duration: '100%',
      offset: -600,
      reverse: true,
    })
      .setClassToggle('#reveal2', 'visible')
      .addTo(this.controller);

    // Scene 3
    const revealElements = document.getElementsByClassName('digit');
    for (let i = -1; i < revealElements.length; i++) {
      new ScrollMagic.Scene({
        triggerElement: revealElements[i],
        offset: 50,
        triggerHook: 0.9,
        reverse: true,
      })
        .setClassToggle(revealElements[i], 'visible')
        .addTo(this.controller);
    }

    // Scene 4 to be added
    new ScrollMagic.Scene({
      triggerElement: '#trigger4',
      triggerHook: 0.9,
      duration: '100%',
      reverse: true,
    })
      .setClassToggle('#reveal4', 'visible')
      .addTo(this.controller);
  }
}


