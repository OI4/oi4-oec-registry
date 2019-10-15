export interface IConformity {
  oi4Id: EValidity;
  resource: IOI4TopicResource;
  checkedResourceList: string[];
  profileResourceList: string[];
  nonProfileResourceList: string[];
  validity: EValidity;
}

interface IOI4TopicResource {
  [key: string]: IOI4TopicValidity;
}

interface IOI4TopicValidity {
  validity: EValidity;
  validityError?: string;
}

export enum EValidity {
  default = 0,
  ok = 1,
  partial = 2,
  nok = 3,
}
