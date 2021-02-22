const PouchDB = orDefault(require("pouchdb"));
PouchDB.plugin(orDefault(require("pouchdb-find")));
const HyperbeePlugin = orDefault(require("pouchdb-adapter-hyperbee"))

const AUTHOR_KEY = "author";
const REGEX_NON_WORDS = /\W+/;
const DEFAULT_SORT = [{ type: "desc" }, { createdAt: "desc" }];

// Based on USHIN data model
// https://github.com/USHIN-Inc/ushin-ui-components/blob/master/src/dataModels/dataModels.ts

let initialized = null;

class USHINBase {
  static init(opts) {
    if (initialized) return initialized;
    initialized = HyperbeePlugin(opts)
    PouchDB.plugin(initialized);
    return initialized;
  }

  static async close () {
    if(initialized) initialized.close()
  }

  constructor({ url, ...opts }) {
    USHINBase.init(opts);
    this.db = new PouchDB(url, {
      adapter: "hyperbee",
    });
  }

  get writable() {
    return this.db.bee.feed.writable;
  }

  get peers() {
    return this.db.bee.feed.peers || [];
  }

  async init() {
    // Wait for the DB to load
    await new Promise((resolve, reject) => {
      this.db.once("open", resolve);
      this.db.once("error", reject);
    });

    this.authorURL = await this.db.getURL();

    // TODO create indexes here based on the sorts of queries we want
    await this.createIndex("type");

    await this.createIndex("type", "createdAt");

    await this.createIndex("type", "createdAt", "textSearch");

    await this.createIndex("type", "createdAt", "allPoints");
  }

  async createIndex(...fields) {
    return this.db.createIndex({
      index: { fields },
    });
  }

  async setAuthorInfo(info = {}) {
    const { _rev, _id, ...data } = await this.getAuthorInfo();
    await this.db.put({
      ...data,
      ...info,
      _id: AUTHOR_KEY,
      _rev,
    });
  }

  async getAuthorInfo() {
    try {
      const info = await this.db.get(AUTHOR_KEY);
      return info;
    } catch (e) {
      if (e.name === "not_found") {
        await this.db.put({ _id: AUTHOR_KEY });
        // No need to await when returning from async fn
        return this.db.get(AUTHOR_KEY);
      } else {
        throw e;
      }
    }
  }

  async addMessage(
    {
      _id,
      _rev,
      revisionOf,
      main,
      responseHistory,
      createdAt = new Date(),
      shapes = {},
    },
    pointStore = {}
  ) {
    if (!main) throw new Error("Message lacks main point");

    const { authorURL } = this;

    let createdAtTime;
    if (typeof createdAt === "string") {
      createdAtTime = new Date(createdAt).getTime();
    } else if (typeof createdAt === "object") {
      createdAtTime = createdAt.getTime();
    } else {
      throw new Error(
        "message's createdAt attribute is neither of type string nor object"
      );
    }

    const allPoints = new Set([main, ...Object.values(shapes).flat()]);

    // Convert allPoints set to array to avoid iterating over pointIds which are
    // added from referenceHistory
    for (const pointId of [...allPoints]) {
      const point = pointStore[pointId];
      if (!point) {
        const error = new Error("Point ID not found in store");
        error.pointId = pointId;
        throw error;
      }
      if (!point._id) throw new Error("Must specify point ID");
      if (!point._rev) {
        await this.addPoint({ createdAt: createdAtTime, ...point });
      }
      if (point.referenceHistory) {
        for (const log of point.referenceHistory) allPoints.add(log.pointId);
      }
    }

    const toSave = {
      _id,
      type: "message",
      revisionOf,
      main,
      responseHistory,
      createdAt: createdAtTime,
      author: authorURL,
      shapes,
      allPoints: [...allPoints],
    };

    if (_id && _rev) {
      await this.db.put({ ...toSave, _rev });
      return _id;
    } else {
      const { id } = await this.db.post(toSave);

      return id;
    }
  }

  async getMessage(id) {
    const rawMessage = await this.db.get(id);
    const { createdAt } = rawMessage;
    const createdAtDate = new Date(createdAt);

    return { ...rawMessage, createdAt: createdAtDate };
  }

  async searchMessages(
    selector = {},
    { limit = 32, skip, sort = DEFAULT_SORT } = {}
  ) {
    const finalSelector = {
      createdAt: { $exists: true },
      ...selector,
      type: "message",
    };

    const result = await this.db.find({
      selector: finalSelector,
      sort,
      limit,
      skip,
    });

    const { docs } = result;

    return docs.map((rawMessage) => {
      const createdAtDate = new Date(rawMessage.createdAt);
      return { ...rawMessage, createdAt: createdAtDate };
    });
  }

  async searchMessagesForPoints(points, ...args) {
    const allPoints = points.map(({ _id }) => _id);

    return this.searchMessages(
      {
        allPoints: {
          $elemMatch: {
            $in: allPoints,
          },
        },
      },
      ...args
    );
  }

  async getPointsForMessage(
    { main, shapes, responseHistory },
    existingPoints = {}
  ) {
    let pointIds = [main, ...Object.values(shapes).flat()];

    const allResponsePointIds = new Set();
    for (const response of responseHistory) {
      allResponsePointIds.add(response.mainPointId);
      if (response.secondaryPointId !== undefined) {
        allResponsePointIds.add(response.secondaryPointId);
      }
    }

    pointIds = pointIds.concat(Array.from(allResponsePointIds));

    const dedupedPointIds = pointIds.filter((id) => !existingPoints[id]);

    const points = await Promise.all(
      dedupedPointIds.map((id) => this.getPoint(id))
    );

    const referencePointIds = new Set();
    for (const point of points) {
      if (point.referenceHistory) {
        for (const log of point.referenceHistory) {
          referencePointIds.add(log.pointId);
        }
      }
    }

    const dedupedReferencePointIds = [...referencePointIds].filter(
      (id) => !existingPoints[id]
    );

    const referencePoints = await Promise.all(
      dedupedReferencePointIds.map((id) => this.getPoint(id))
    );

    points.push(...referencePoints);

    return points.reduce((result, point) => {
      result[point._id] = point;
      return result;
    }, {});
  }

  async searchPointsByContent(
    query,
    { limit = 32, skip, sort = DEFAULT_SORT } = {}
  ) {
    const tokens = stringToTokens(query);
    const { docs } = await this.db.find({
      selector: {
        type: "point",
        textSearch: { $all: tokens },
        createdAt: { $exists: true },
      },
      sort,
      limit,
      skip,
    });

    return docs;
  }

  async addPoint(point) {
    let textSearch;
    const { _id, content, createdAt } = point;

    // Only set the textSearch property if there's content for this point
    if (content) {
      const tokens = stringToTokens(content);
      if (tokens.length) textSearch = tokens;
    }

    const doc = {
      ...point,
      _id,
      type: "point",
      content,
      createdAt: createdAt || Date.now(),
      textSearch,
    };

    if (!_id) {
      const { id } = await this.db.post(doc);
      return id;
    } else {
      await this.db.put(doc);
      return _id;
    }
  }

  // TODO: Throw error if document isn't a point?
  async getPoint(id) {
    return this.db.get(id);
  }

  async close() {
    return this.db.close();
  }
}

module.exports = {
  USHINBase,
};

// This is necessary to account for Webpack environments
// Pouch exports ESM when possible, and Webpack doesn't normalize it back
function orDefault(module) {
  if (module.default) return module.default;
  return module;
}

// Convert some text to tokens which can be used for searching
function stringToTokens(content) {
  const lowered = content.toLowerCase();
  const rawTokens = lowered.split(REGEX_NON_WORDS);
  const nonEmpty = rawTokens.filter((item) => !!item);
  const deduped = new Set(nonEmpty);
  return [...deduped];
}
