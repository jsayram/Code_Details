import { trigger, state, style, animate, transition,keyframes } from '@angular/animations';

export const animationTriggers = [
trigger('fadeIn', [
    state('hidden', style({ opacity: 0 })),
    state('visible', style({ opacity: 1 })),
    transition('hidden => visible', animate('500ms ease-in')),
    transition('visible => hidden', animate('500ms ease-out')),
  ]),
  
  trigger('slideIn', [
    state('hidden', style({ transform: 'translateX(-100%)' })),
    state('visible', style({ transform: 'translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  
  trigger('slideInRight', [
    state('hidden', style({ transform: 'translateX(100%)' })),
    state('visible', style({ transform: 'translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  
  trigger('slideInLeft', [
    state('hidden', style({ transform: 'translateX(-100%)' })),
    state('visible', style({ transform: 'translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  
  trigger('slideInTop', [
    state('hidden', style({ transform: 'translateY(-100%)' })),
    state('visible', style({ transform: 'translateY(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('slideInBottom', [
    state('hidden', style({ transform: 'translateY(100%)' })),
    state('visible', style({ transform: 'translateY(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  
  trigger('scaleIn', [
    state('hidden', style({ transform: 'scale(0)' })),
    state('visible', style({ transform: 'scale(1)' })),
    transition('hidden => visible', animate('700ms ease-in')),
    transition('visible => hidden', animate('700ms ease-out')),
  ]),
  
  trigger('scaleInTop', [
    state('hidden', style({ transform: 'scale(0) translateY(-100%)' })),
    state('visible', style({ transform: 'scale(1) translateY(0)' })),
    transition('hidden => visible', animate('700ms ease-in')),
    transition('visible => hidden', animate('700ms ease-out')),
  ]),
  
  trigger('scaleInBottom', [
    state('hidden', style({ transform: 'scale(0) translateY(100%)' })),
    state('visible', style({ transform: 'scale(1) translateY(0)' })),
    transition('hidden => visible', animate('700ms ease-in')),
    transition('visible => hidden', animate('700ms ease-out')),
  ]),
  
  trigger('scaleInLeft', [
    state('hidden', style({ transform: 'scale(0) translateX(-100%)' })),
    state('visible', style({ transform: 'scale(1) translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('scaleInRight', [
    state('hidden', style({ transform: 'scale(0) translateX(100%)' })),
    state('visible', style({ transform: 'scale(1) translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('rotateIn', [
    state('hidden', style({ transform: 'rotate(-180deg)' })),
    state('visible', style({ transform: 'rotate(0deg)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('rotateInLeft', [
    state('hidden', style({ transform: 'rotate(-180deg) translateX(-100%)' })),
    state('visible', style({ transform: 'rotate(0deg) translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('rotateInRight', [
    state('hidden', style({ transform: 'rotate(180deg) translateX(100%)' })),
    state('visible', style({ transform: 'rotate(0deg) translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('rotateInTop', [
    state('hidden', style({ transform: 'rotate(180deg) translateY(-100%)' })),
    state('visible', style({ transform: 'rotate(0deg) translateY(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('rotateInBottom', [
    state('hidden', style({ transform: 'rotate(-180deg) translateY(100%)' })),
    state('visible', style({ transform: 'rotate(0deg) translateY(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('flipIn', [
    state('hidden', style({ transform: 'rotateY(180deg)' })),
    state('visible', style({ transform: 'rotateY(0deg)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('flipInLeft', [
    state('hidden', style({ transform: 'rotateY(180deg) translateX(-100%)' })),
    state('visible', style({ transform: 'rotateY(0deg) translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('flipInRight', [
    state('hidden', style({ transform: 'rotateY(-180deg) translateX(100%)' })),
    state('visible', style({ transform: 'rotateY(0deg) translateX(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('flipInTop', [
    state('hidden', style({ transform: 'rotateX(180deg) translateY(-100%)' })),
    state('visible', style({ transform: 'rotateX(0deg) translateY(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('flipInBottom', [
    state('hidden', style({ transform: 'rotateX(-180deg) translateY(100%)' })),
    state('visible', style({ transform: 'rotateX(0deg) translateY(0)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('lightSpeedIn', [
    state('hidden', style({ transform: 'translateX(100%) skewX(-30deg)' })),
    state('visible', style({ transform: 'translateX(0%) skewX(0deg)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('lightSpeedInLeft', [
    state('hidden', style({ transform: 'translateX(-100%) skewX(-30deg)' })),
    state('visible', style({ transform: 'translateX(0%) skewX(0deg)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('lightSpeedInRight', [
    state('hidden', style({ transform: 'translateX(100%) skewX(-30deg)' })),
    state('visible', style({ transform: 'translateX(0%) skewX(0deg)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('lightSpeedInTop', [
    state('hidden', style({ transform: 'translateY(-100%) skewY(-30deg)' })),
    state('visible', style({ transform: 'translateY(0%) skewY(0deg)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('lightSpeedInBottom', [
    state('hidden', style({ transform: 'translateY(100%) skewY(-30deg)' })),
    state('visible', style({ transform: 'translateY(0%) skewY(0deg)' })),
    transition('hidden => visible', animate('600ms ease-in')),
    transition('visible => hidden', animate('600ms ease-out')),
  ]),
  trigger('BounceIn', [
    state('hidden', style({ transform: 'scale(0.3)', opacity: 0 })),
    state('visible', style({ transform: 'scale(1)', opacity: 1 })),
    transition('hidden => visible', [
      animate('0.6s ease-out', keyframes([
        style({ transform: 'scale(0.3)', opacity: 0, offset: 0 }),
        style({ transform: 'scale(1.1)', offset: 0.4 }),
        style({ transform: 'scale(0.9)', offset: 0.6 }),
        style({ transform: 'scale(1.03)', opacity: 1, offset: 0.8 }),
        style({ transform: 'scale(1)', opacity: 1, offset: 1 }),
      ]))
    ]),
    transition('visible => hidden', [
      animate('0.3s ease-in', keyframes([
        style({ transform: 'scale(1)', offset: 0 }),
        style({ transform: 'scale(0.5)', opacity: 0.5, offset: 0.5 }),
        style({ transform: 'scale(0.3)', opacity: 0, offset: 1 }),
      ]))
    ])
  ]),
  trigger('Elastic', [
    state('hidden', style({ transform: 'scale(0.5)', opacity: 0 })),
    state('visible', style({ transform: 'scale(1)', opacity: 1 })),
    transition('hidden => visible', [
      animate('1s cubic-bezier(0.68,-0.55,0.265,1.55)', keyframes([
        style({ transform: 'scale(0.5)', opacity: 0, offset: 0 }),
        style({ transform: 'scale(1.3)', opacity: 0.5, offset: 0.2 }),
        style({ transform: 'scale(0.9)', opacity: 1, offset: 0.4 }),
        style({ transform: 'scale(1.1)', opacity: 1, offset: 0.6 }),
        style({ transform: 'scale(1)', opacity: 1, offset: 1 }),
      ]))
    ]),
    transition('visible => hidden', [
      animate('0.3s ease-in', keyframes([
        style({ transform: 'scale(1)', offset: 0 }),
        style({ transform: 'scale(0.5)', opacity: 0.5, offset: 0.5 }),
        style({ transform: 'scale(0.5)', opacity: 0, offset: 1 }),
      ]))
    ])
  ])
];