import { Component, OnInit } from '@angular/core';
import { TutorialService } from 'src/app/services/tutorial.service';
import { map } from 'rxjs/operators';
import { Tutorial } from 'src/app/models/tutorial.model';

import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable } from 'rxjs';
import algoliasearch from 'algoliasearch/lite';
import { environment } from 'src/environments/environment';
import { MultipleQueriesQuery } from '@algolia/client-search';
import { query } from '@angular/animations'; 
import { ModalService } from 'src/app/modal-w';
import { Console } from 'console';

//import fontawesome
import { library, dom } from '@fortawesome/fontawesome-svg-core'; // below are the imports then just add to library icons below
import { faEarth,faCircleXmark } from '@fortawesome/free-solid-svg-icons';
import { faGithub,faLinkedin } from '@fortawesome/free-brands-svg-icons';


const searchClient = algoliasearch(
  environment.algolia.algoliaAPP_ID,
  environment.algolia.algoliaAdminAPI_KEY
);


@Component({
  selector: 'app-tutorials-list',
  templateUrl: './tutorials-list.component.html',
  styleUrls: ['./tutorials-list.component.css',
  '../../../styles.css']
})
export class TutorialsListComponent implements OnInit {
  //load the array of icons to use in the project
  faEarth = faEarth;
  faCircleXmark = faCircleXmark;
  faGithub = faGithub;
  faLinkedin = faLinkedin;

  bodyText?:string;

  tutorials?: Tutorial[];
  currentTutorial?: Tutorial;
  tag?:string;
  currentIndex = -1;
  state = false;
  title = 'Code Details';
  searchConfig = {
    indexName: 'tutorialContent',
    searchClient
  };

  s: string = "InsideThe OPEN MODAL FUNCTION";
  //   //it shows all results by default so
  //  // adding this to not show results by default
  //  showResults= false;
  
  constructor(private tutorialService: TutorialService, 
              private modalService: ModalService) { 
             
  }
 

  ngOnInit(): void {
    this.bodyText = 'This text can be updated in modal 1';
  }
  openModal(id: string) {
    console.log(this.s + id);
    this.modalService.open(id);
  }

  closeModal(id: string) {
    
    this.modalService.close(id);
  }

  // refreshList(): void {
  //   this.currentTutorial = undefined;
  //   this.currentIndex = -1;
  //   this.retrieveTutorials();
  // }

  // retrieveTutorials(): void {
  //   this.tutorialService.getAll().snapshotChanges().pipe(
  //     map(changes =>
  //       changes.map(c =>
  //         ({ id: c.payload.doc.id, ...c.payload.doc.data() })
  //       )
  //     )
  //   ).subscribe(data => {
  //     this.tutorials = data;
  //   });
  // }

  // setActiveTutorial(tutorial: Tutorial, index: number): void {
  //   this.currentTutorial = tutorial;
  //   this.currentIndex = index;
  // }

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