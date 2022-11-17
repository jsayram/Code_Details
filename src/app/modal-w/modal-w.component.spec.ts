import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWComponent } from './modal-w.component';

describe('ModalWComponent', () => {
  let component: ModalWComponent;
  let fixture: ComponentFixture<ModalWComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ModalWComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ModalWComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
