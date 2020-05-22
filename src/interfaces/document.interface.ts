import JAPIError from "../models/error.model";
import Link from "../models/link.model";
import Meta from "../models/meta.model";
import ResourceIdentifier from "../models/resource-identifier.model";
import Resource from "../models/resource.model";
import { Dictionary, SingleOrArray } from "../types/global.types";
import { PaginationOf } from "./paginator.interface";

export interface DataDocument<PrimaryType extends Dictionary<any>> extends BaseDocument {
 links?: LinkObject | PaginationOf<Link>;
 included?: Resource[];
 data?: PrimaryData<PrimaryType>;
}

export interface ErrorDocument extends BaseDocument {
 errors?: JAPIError[];
}

export interface JSONAPIObject {
 version?: string;
 meta?: Meta;
}

export interface BaseDocument {
 jsonapi?: JSONAPIObject;
 meta?: Meta;
}

export type LinkObject = Partial<Dictionary<Link | null>>;

export type PrimaryData<T> = SingleOrArray<ResourceIdentifier> | SingleOrArray<Resource<T>> | null;

export type ResourceLinkage = SingleOrArray<ResourceIdentifier> | null;
