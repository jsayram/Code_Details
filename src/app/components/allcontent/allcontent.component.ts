import { Component, OnInit } from '@angular/core';
import { TutorialService } from 'src/app/services/tutorial.service';
import { Tutorial } from 'src/app/models/tutorial.model';

import { environment } from 'src/environments/environment';
import { MultipleQueriesQuery } from '@algolia/client-search';

import { map } from 'rxjs/operators'; //needed to retrieve tutorial from firebase, not using algolia

import { ModalService } from 'src/app/components/modal-w';
import { Console } from 'console';

//import fontawesome
import { library, dom } from '@fortawesome/fontawesome-svg-core'; // below are the imports then just add to library icons below
import { faEarth,faCircleXmark } from '@fortawesome/free-solid-svg-icons';
import { faGithub,faLinkedin } from '@fortawesome/free-brands-svg-icons';

@Component({
  selector: 'app-allcontent',
   templateUrl: './allcontent.component.html',
   styleUrls: ['./allcontent.component.scss']
})

export class AllcontentComponent implements OnInit {
  //load the array of icons to use in the project
  faEarth = faEarth;
  faCircleXmark = faCircleXmark;
  faGithub = faGithub;
  faLinkedin = faLinkedin;

  // bodyText?:string;
  // searchAsYouType?: boolean;
  
  
  tutorials?: Tutorial[];
  currentTutorial?: Tutorial;
  tag?:string;
  currentIndex = -1;
  
  state = false;
  title = 'Code Details';
  

  s: string = "All Content Modal ID of Card = ";
  //   //it shows all results by default so
  //  // adding this to not show results by default
  //showResults= false;
  
  constructor(private tutorialService: TutorialService, 
              private modalService: ModalService) { 
             
  }
 

  ngOnInit(): void {
    this.retrieveTutorials();
    //this.bodyText = 'This text can be updated in modal 1';
  }

  openModal(id: string) {
    console.log(this.s + id);
    this.modalService.open(id);
  }

  closeModal(id: string) {
    this.modalService.close(id); 
    console.log("ClOSING THIS MODAL" + id);
  }

  refreshList(): void {
    this.currentTutorial = undefined;
    this.currentIndex = -1;
  }

  retrieveTutorials(): void {
    this.tutorialService.getAll().snapshotChanges().pipe(
      map(changes =>
        changes.map(c =>
          ({ id: c.payload.doc.id, ...c.payload.doc.data() })
        )
      )
    ).subscribe(data => {
      this.tutorials = data;
    });
  }

  setActiveTutorial(tutorial: Tutorial, index: number): void {
    this.currentTutorial = tutorial;
    this.currentIndex = index;
  }

//FOR DEBUGING PURPOSES ONLY  
  //It is used in the dom to show the current tutorial id and title in the console log 
  //exmaple usage in the dom: (click)="logToConsole(hit.id!)"
  logToConsole(message: string, tag: string,domMessage: string): void {
    console.log(message + "= ID , route is not right for this tag:" + tag + " AND " + domMessage);
  }
  // searchChange(query: string) {
  //   if(query.length > 0) {
  //     this.showResults = true;
  //   }else{
  //     this.showResults = false;
  //   }
    
  // } 
  // searchSubmit(query: string) {
  //   if(query.length > 0) {
  //     this.showResults = true;
  //   }else{
  //     this.showResults = false;
  //   }
  // } 
  // searchReset(query: string) {
  //   this.showResults = false;
  // }

  // blurEvent(query: string) {
  //   this.showResults = false;
  // }


  
}