import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
    //add current year 
    currentYear = new Date().getFullYear(); // </p>&copy; {{currentYear}} </p>

} //end class
