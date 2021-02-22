import type {SDKOptions} from 'hyper-sdk'

declare module "ushin-db" {
  export interface UshinBaseConstructorOptions extends SDKOptions {
    url: string
  }

  export type AuthorInfo = {
    _id: string;
    _rev: string;
    name: string;
    color: string;
  };

  type PickPartial<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>> &
    Partial<Pick<T, K>>;

  export type AuthorInfoOnlyIdAndRevRequired = PickPartial<
    AuthorInfo,
    "name" | "color"
  >;

  // TODO import interface from USHIN here
  export type Message = any;
  export type Point = any;
  export interface PointStore {
    [_id: string]: Point;
  }

  export type ID = string;

  export interface SearchLimits {
    limit?: number;
    skip?: number;
    sort?: number;
  }

  export class USHINBase {
    constructor(options: UshinBaseConstructorOptions);
    init(): Promise<undefined>;
    createIndex(...fields: string[]): Promise<undefined>;
    setAuthorInfo(info: AuthorInfo): Promise<undefined>;
    getAuthorInfo(): Promise<AuthorInfoOnlyIdAndRevRequired>;
    addMessage(message: Message, points: PointStore): Promise<ID>;
    getMessage(id: ID): Promise<Message>;
    searchMessages(
      selector: any,
      searchLimits?: SearchLimits
    ): Promise<Message[]>;
    getPointsForMessage(message: Message, existingPoints?:  PointStore): Promise<PointStore>;
    searchPointsByContent(
      query: string,
      searchLimits?: SearchLimits
    ): Promise<Point[]>;
    searchMessagesForPoints(points: Point[]): Promise<Message[]>;
    addPoint(point: Point): Promise<ID>;
    getPoint(id: ID): Promise<Point>;
    close(): Promise<undefined>;
  }
}
