import { Component, OnInit, HostListener, ElementRef  } from '@angular/core';
import algoliasearch, { SearchIndex } from 'algoliasearch/lite';
import { environment } from 'src/environments/environment';
import { ModalService } from 'src/app/components/modal-w';
import { ChangeDetectorRef } from '@angular/core';

const searchClient = algoliasearch(
  environment.algolia.algoliaAPP_ID,
  environment.algolia.algoliaAdminAPI_KEY
);

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.scss']
})
export class SearchComponent implements OnInit {
  constructor(private modalService: ModalService, private cd: ChangeDetectorRef, private myElement: ElementRef) {
    this.index = searchClient.initIndex('tutorialContent');
  }

  @HostListener('document:click', ['$event'])
  public documentClick(event: Event): void {
    if (!this.myElement.nativeElement.contains(event.target)) {
      this.hits = [];
    }
  }



  index: SearchIndex;
  hits: any[] = [];
  searchTerm!: string;


  s: string = "INSIDE THE OPEN MODAL FUNCTION : ";
  

  clearSearch() {
    this.searchTerm = '';
    this.hits = [];
    
}

// search parameters
searchParameters = {
  hitsPerPage: 3,
  attributesToHighlight: ['title', 'description', 'tags','url'],
  highlightPreTag: '<strong>',
  highlightPostTag: '</strong>'
};


 

  ngOnInit(): void {
  }
 ngAfterOnInt(): void {
  this.cd.detectChanges();
 }

  // openModal(id: string) {
  //   console.log(this.s + id);
  //   this.modalService.open(id);
  // }

  // closeModal(id: string) {
  //   this.modalService.close(id); 
  // }

  // search() {
  //   // Removes trailing spaces
  //   let trimmedSearchTerm = this.searchTerm.trimEnd();
  //   if (trimmedSearchTerm !== '') {
  //     this.index.search(trimmedSearchTerm, this.searchParameters)
  //       .then(({ hits }) => {
  //         this.hits = hits;
  //         if (hits.length === 0) { // No hits from Algolia
  //           this.searchLabels();
  //         }
  //         this.cd.detectChanges();
  //       })
  //       .catch(err => {
  //         console.log(err);
  //       });
  //   } else {
  //     console.log("No search term provided.");
  //   }
  // }


  search() {
    // Removes trailing spaces
    let trimmedSearchTerm = this.searchTerm.trimEnd();
    if (trimmedSearchTerm !== '') {
      this.index.search(trimmedSearchTerm, this.searchParameters)
        .then(({ hits }) => {
          if (hits.length === 0) { // No hits from Algolia
            this.searchLabels();
          } else {
            this.hits = hits;
            this.cd.detectChanges();
          }
        })
        .catch(err => {
          console.log(err);
        });
    } else {
      console.log("No search term provided.");
    }
  }
  
  searchLabels() {
    const elements = document.querySelectorAll('h1, h2, h3, h4, p');
    const matchedLabels: { label: string }[] = [];
  
    elements.forEach(element => {
      const elementContent = element.textContent || '';
  
      if (elementContent.toLowerCase().includes(this.searchTerm.trimEnd().toLowerCase())) {
        matchedLabels.push({ label: elementContent });
      }
    });
  
    this.hits = matchedLabels;
    this.cd.detectChanges();
  }
  

  

  

}