import { NgModule, Pipe, PipeTransform } from '@angular/core';
import { BrowserModule, DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

//material design modules
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatLegacyButtonModule as MatButtonModule } from '@angular/material/legacy-button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatLegacyTabsModule as MatTabsModule} from '@angular/material/legacy-tabs';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatLegacyCardModule as MatCardModule } from '@angular/material/legacy-card';
import { MatLegacyInputModule as MatInputModule } from '@angular/material/legacy-input';
import { MatLegacyFormFieldModule as MatFormFieldModule } from '@angular/material/legacy-form-field';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

//these are the angular firebase modules
import { AngularFireModule } from '@angular/fire/compat'
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { AngularFireAnalyticsModule } from '@angular/fire/compat/analytics';

//algolia search for instasearch firebase
import { NgAisModule } from 'angular-instantsearch';

//install scrolling module
import { ScrollingModule } from '@angular/cdk/scrolling';

/*My Custom Components Below*/
import { ModalModule } from './components/modal-w';
import { AddTutorialComponent } from './components/add-tutorial/add-tutorial.component';
import { TutorialDetailsComponent } from './components/tutorial-details/tutorial-details.component';
import { TutorialsListComponent } from './components/tutorials-list/tutorials-list.component';
import { HomePageComponent } from './components/home-page/home-page.component';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SearchComponent } from './components/search/search.component';
import { AllcontentComponent } from './components/allcontent/allcontent.component'; 

//environment import
import { environment } from '../environments/environment';

//fontawesome imports
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons';
import { faCircleXmark, faSearch, faClose, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { faAddressBook } from '@fortawesome/free-regular-svg-icons'


/*Array of Icons added
in the DOM just add the [icon] directive and it will show the icon
[icon]="['fas', 'circle-xmark']" as example fas is the prefix and circle-xmark is the icon name
check out the documentation for more info on the site https://fontawesome.com/search?m=free&o=r
*/
const icons = [
  faGithub,
  faLinkedin,
  faCircleXmark,
  faSearch,
  faClose,
  faMagnifyingGlass,
  faAddressBook
];

/*This is the pipe to make the url safe to use in DOM it works like this
name is safe and it takes a url string and returns a safe url
<iframe [src]="tutorial.url | safe"></iframe>
*/ 
@Pipe({ name: 'safe' })
export class SafePipe implements PipeTransform {
  constructor(private domSanitizer: DomSanitizer) {}
  transform(url: string) {
    return this.domSanitizer.bypassSecurityTrustResourceUrl(url);
  }
} 
/* this is the pipe to make the html safe to use in DOM it works like this
name is safeHtml and it takes a html string and returns a safe html
<div [innerHTML]="tutorial.description | safeHtml"></div>
*/
@Pipe({
  name: 'safeHtml'
})
export class SafeHtmlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) { }
  transform(value: any): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(value);
  }
}
/* this is the pipe to extract the image from the youtube url it works like this
name is extractImageFromEmbededYoutubeUrl and it takes a url string and returns a image url
<img [src]="tutorial.url | extractImageFromYoutubeUrl" alt="tutorial image">
*/
@Pipe({
  name: 'extractImageFromEmbeddedYoutubeUrl'
})
export class ExtractImageFromEmbeddedYoutubeUrlPipe implements PipeTransform {
  transform(url: string, resolutionType: string='hqdefault'): string {
    let videoId = url.split('embed/')[1];
    const ampersandPosition = videoId.indexOf('&');
    if (ampersandPosition !== -1) {
      videoId = videoId.substring(0, ampersandPosition);
    }
    return `https://img.youtube.com/vi/${videoId}/${resolutionType}.jpg`;
  }
}


@NgModule({
  declarations: [
    //pipe declarations
    SafePipe,
    SafeHtmlPipe,
    ExtractImageFromEmbeddedYoutubeUrlPipe,

    //custom components
    AppComponent,
    AddTutorialComponent,
    TutorialDetailsComponent,
    TutorialsListComponent,
    HomePageComponent,
    NavbarComponent,
    SearchComponent,
    AllcontentComponent,

  ],
  imports: [
    BrowserModule,
    FormsModule,
    // NgAisHitsModule,
    AppRoutingModule,
    ModalModule,
    FontAwesomeModule,
    ScrollingModule,
    
    NgAisModule.forRoot(),

    BrowserAnimationsModule,

    AngularFireModule.initializeApp(environment.firebase,'codedetailsapp'),
    AngularFirestoreModule,
    AngularFireAuthModule,
    AngularFireAnalyticsModule,
    MatToolbarModule,
    MatSidenavModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTabsModule,
    MatGridListModule,
    MatCardModule,
    MatInputModule,
    MatFormFieldModule,
    
  ],
  providers: [],
  bootstrap: [AppComponent] //only found in the main app module
})
export class AppModule {
  /*This contructor is for the fontawesome icons
  it takes the library and adds the icons to the library so they can be used in the DOM
  example: <fa-icon [icon]="['fas', 'circle-xmark']"></fa-icon>
  */
  constructor(library: FaIconLibrary) {
    library.addIcons(...icons)
  }
}
