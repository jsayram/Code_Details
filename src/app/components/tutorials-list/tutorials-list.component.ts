import { Component, OnInit } from '@angular/core';
import { TutorialService } from 'src/app/services/tutorial.service';
import { map } from 'rxjs/operators';
import { Tutorial } from 'src/app/models/tutorial.model';

import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable } from 'rxjs';
import algoliasearch from 'algoliasearch/lite';
import { environment } from 'src/environments/environment';


const searchClient = algoliasearch(
  environment.algolia.algoliaAPP_ID,
  environment.algolia.algoliaAdminAPI_KEY
);


@Component({
  selector: 'app-tutorials-list',
  templateUrl: './tutorials-list.component.html',
  styleUrls: ['./tutorials-list.component.css']
})
export class TutorialsListComponent implements OnInit {
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
  
  constructor(private tutorialService: TutorialService) { 
  }
 

  ngOnInit(): void {
    this.retrieveTutorials();
  }

  refreshList(): void {
    this.currentTutorial = undefined;
    this.currentIndex = -1;
    this.retrieveTutorials();
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

   //it shows all results by default so
   // adding this to not show results by default
   showResults= false;

  searchChange(query: string) {
    if(query.length > 0) {
      this.showResults = true;
    }else {
      this.showResults = false;
    }
  } 
  //reset search
  // resetSearch(query: string) {
  //   this.showResults = false;
  // }

  
}