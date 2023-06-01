import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

//custom components
import { TutorialsListComponent } from './components/tutorials-list/tutorials-list.component';
import { AddTutorialComponent } from './components/add-tutorial/add-tutorial.component';
import { TutorialDetailsComponent } from './components/tutorial-details/tutorial-details.component';
import { HomePageComponent } from './components/home-page/home-page.component';
import { AllcontentComponent } from './components/allcontent/allcontent.component';

const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home',component: HomePageComponent},
  { path: 'all', component: AllcontentComponent},
  { path: 'tutorials', component: TutorialsListComponent},
  { path: 'add', component: AddTutorialComponent},
  { path: 'details', component: TutorialDetailsComponent},
  { path: 'flutter', component: TutorialDetailsComponent },
  { path: 'tutorials/:id', component: TutorialDetailsComponent},
  //path for anything else
  // { path: '**', redirectTo: 'home'}
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }