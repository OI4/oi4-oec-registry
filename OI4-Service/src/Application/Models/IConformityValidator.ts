export interface IConformity {
  oi4Id: EValidity;
  resource: IValidityLookup;
  checkedResourceList: string[];
  profileResourceList: string[];
  nonProfileResourceList: string[];
  validity: EValidity;
}

interface IValidityLookup {
  [key: string]: IValidityDetails;
}

export interface IValidityDetails {
  validity: EValidity;
  payload: any;
  validityError?: string;
}

export enum EValidity {
  default = 0,
  ok = 1,
  partial = 2,
  nok = 3,
}
