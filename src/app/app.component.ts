import { Component } from '@angular/core';
import algoliasearch from 'algoliasearch/lite';
import { environment } from '../environments/environment';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Tutorial } from './models/tutorial.model';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { TutorialService } from './services/tutorial.service';


//  const searchClient = algoliasearch(
//     environment.algolia.algoliaAPP_ID,
//     environment.algolia.algoliaAdminAPI_KEY
//  );

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {

  // title: string = 'Code Details';
  // searchConfig = {
  //   indexName: 'tutorialContent',
  //   searchClient
  //   };
    
  // tutorials?: Tutorial[];
  // currentTutorial?: Tutorial;
  // currentIndex = -1;

  // //it shows all results by default so adding this to not show results by default
  // showResults: boolean | undefined;
  // //constructor
  // constructor(  private firestore: AngularFirestore, public auth: AngularFireAuth,private tutorialService: TutorialService) {
  //   this.auth.signInAnonymously();
  // } //end constructor
  
  //   searchChange(query: string) {
     
  //   if(query.length > 0) {
  //     this.showResults = true;
  //   }else {
  //     this.showResults = false;
  //   }
  // } 
} //end class
