import { Component, OnInit } from '@angular/core';
import algoliasearch from 'algoliasearch/lite';
import { environment } from 'src/environments/environment';

import { ModalService } from 'src/app/components/modal-w';

//import algolia search client
import { SearchClient } from 'algoliasearch';
import { AlgoliaSearchHelper} from 'algoliasearch-helper';

//search client for algolia usinh environment variables
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

  //algolia search configuration holds index name and search client
  searchConfig = {
    indexName: 'tutorialContent',
    searchClient,
    // searchFunction: (helper: AlgoliaSearchHelper) => {
    //   helper.setQueryParameter('hitsPerPage', 3);
    //   //console.log('fucking thing ran: '+helper.search());
    //   // Store and log the query before search is performed
    //   let lastQuery = helper.state.query;
    // },
  };
  s: string = "INSIDE THE OPEN MODAL FUNCTION : ";
  //search parameters
  searchParameters = {
    hitsPerPage: 3
  };
  
  constructor(private modalService: ModalService) {}

  ngOnInit(): void {
  }
  ngAfterOnInt(): void {
  }
  openModal(id: string) {
    console.log(this.s + id);
    this.modalService.open(id);
  }
  closeModal(id: string) {
    this.modalService.close(id); 
  }

}
