import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

//algolia search for instasearch firebase
import { NgAisInstantSearchModule} from 'angular-instantsearch';
import { NgAisSearchBoxModule} from 'angular-instantsearch';
import { NgAisHitsModule} from 'angular-instantsearch';
import { NgAisHighlightModule} from 'angular-instantsearch';
import { NgAisRefinementListModule} from 'angular-instantsearch';
import { NgAisClearRefinementsModule} from 'angular-instantsearch';
import { NgAisConfigureModule} from 'angular-instantsearch';
import { NgAisStatsModule} from 'angular-instantsearch';
import { NgAisPaginationModule} from 'angular-instantsearch';
import { NgAisSortByModule} from 'angular-instantsearch';
import { NgAisRangeSliderModule} from 'angular-instantsearch';
import { NgAisRangeInputModule} from 'angular-instantsearch';
import { NgAisNumericMenuModule} from 'angular-instantsearch';
import { NgAisBreadcrumbModule} from 'angular-instantsearch';
import { NgAisCurrentRefinementsModule} from 'angular-instantsearch';
import { NgAisMenuModule} from 'angular-instantsearch';
import { NgAisToggleModule} from 'angular-instantsearch';
import { NgAisHierarchicalMenuModule} from 'angular-instantsearch';
import { NgAisSnippetModule} from 'angular-instantsearch';


import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

//environment import
import { environment } from '../environments/environment';

//these are the angular firebase modules
import { AngularFireModule } from '@angular/fire/compat'
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { AngularFireAnalyticsModule } from '@angular/fire/compat/analytics';
import { AddTutorialComponent } from './components/add-tutorial/add-tutorial.component';
import { TutorialDetailsComponent } from './components/tutorial-details/tutorial-details.component';
import { TutorialsListComponent } from './components/tutorials-list/tutorials-list.component';


@NgModule({
  declarations: [
    AppComponent,
    AddTutorialComponent,
    TutorialDetailsComponent,
    TutorialsListComponent,
  ],
  imports: [
    BrowserModule,
    FormsModule,
    NgAisHitsModule,
    AppRoutingModule,

    //insatasearch algolia modules for the html document in the app.component.html
    NgAisInstantSearchModule.forRoot(),
    NgAisSearchBoxModule,
    NgAisHitsModule,
    NgAisHighlightModule,
    NgAisRefinementListModule,
    NgAisClearRefinementsModule,
    NgAisConfigureModule,
    NgAisStatsModule,
    NgAisPaginationModule,
    NgAisSortByModule,
    NgAisRangeSliderModule,
    NgAisRangeInputModule,
    NgAisNumericMenuModule,
    NgAisBreadcrumbModule,
    NgAisSnippetModule,

    BrowserAnimationsModule,
    AngularFireModule.initializeApp(environment.firebase,'codedetailsapp'),
    AngularFirestoreModule,
    AngularFireAuthModule,
    AngularFireAnalyticsModule,
  ],
  providers: [],
  bootstrap: [AppComponent] //only found in the main app module
})
export class AppModule { }
