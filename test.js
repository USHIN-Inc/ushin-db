const { USHINBase } = require("./");
const test = require("tape");

// Pre-initialize the plugin and avoid persistence
USHINBase.init({ persist: false });

async function getNew(url = "hyper://example") {
  const db = new USHINBase({ url });

  await db.init();

  return db;
}

const EXAMPLE_POINT_ID = "Example-Point";

const EXAMPLE_POINT = {
  _id: EXAMPLE_POINT_ID,
  content: "Cats bring me joy",
};

const EXAMPLE_MESSAGE = {
  main: EXAMPLE_POINT_ID,
  shapes: {
    feelings: [EXAMPLE_POINT_ID],
  },
};

const EXAMPLE_POINT_STORE = {
  [EXAMPLE_POINT_ID]: EXAMPLE_POINT,
};

test.onFinish(() => {
  USHINBase.close()
})

test("Able to initialize and set author metadata", async (t) => {
  t.plan(3);
  try {
    var db = await getNew('hyper://t1');

    t.pass("Able to create the DB");

    await db.setAuthorInfo({ name: "Example" });

    t.pass("Able to set author info");

    const { name } = await db.getAuthorInfo();

    t.equal(name, "Example", "name got set and can be retrieved");
  } catch (e) {
    t.error(e);
  } finally {
    if (db) await db.close();
  }
});

test("Able to add and get messages", async (t) => {
  t.plan(8);
  try {
    var db = await getNew('hyper://t2');

    const id = await db.addMessage(EXAMPLE_MESSAGE, EXAMPLE_POINT_STORE);

    t.pass("Able to add message");

    const message = await db.getMessage(id);

    const { author, shapes, createdAt, main } = message;
    const { feelings } = shapes;
    const [pointId] = feelings;

    t.equal(pointId, EXAMPLE_POINT_ID, "Got saved point");

    const pointStore = await db.getPointsForMessage(message);

    const point = pointStore[pointId];

    t.equal(author, db.authorURL, "Author got set");
    t.equal(feelings.length, 1, "Feelings got set");

    t.ok(
      createdAt instanceof Date,
      "Timestamp got auto-generated and is a Date"
    );
    t.equal(main, EXAMPLE_MESSAGE.main, "main id got set");

    t.ok(point, "Got point from store");
    t.equal(point.content, "Cats bring me joy", "Point content got set");
  } catch (e) {
    t.error(e);
  } finally {
    if (db) db.close();
  }
});

test.skip("Able to search for messages in a time range", async (t) => {
  t.plan(6);
  try {
    var db = await getNew('hyper://t3');

    await db.addPoint(EXAMPLE_POINT);

    const point = await db.getPoint(EXAMPLE_POINT_ID);

    const pointStore = { [EXAMPLE_POINT_ID]: point };

    await db.addMessage(
      { createdAt: new Date(10), ...EXAMPLE_MESSAGE },
      pointStore
    );
    await db.addMessage(
      { createdAt: new Date(2000), ...EXAMPLE_MESSAGE },
      pointStore
    );
    await db.addMessage(
      { createdAt: new Date(3000), ...EXAMPLE_MESSAGE },
      pointStore
    );

    t.pass("Able to add several messages");

    const results = await db.searchMessages({ createdAt: { $gt: 100 } });

    t.equal(results.length, 2, "Got expected number of results");

    const [message] = results;
    const { author, shapes, createdAt } = message;
    const { feelings } = shapes;
    const [pointId] = feelings;

    t.equal(pointId, EXAMPLE_POINT_ID, "Got point ID");
    t.equal(author, "test", "Author got set");
    t.equal(feelings.length, 1, "Feelings got set");
    t.ok(
      createdAt instanceof Date,
      "Timestamp got auto-generated and is a Date"
    );
  } catch (e) {
    t.error(e);
  } finally {
    if (db) await db.close();
  }
});

test("Able to search for messages that contain a point ID", async (t) => {
  t.plan(1);
  try {
    var db = await getNew('hyper://t4');

    await db.addMessage(
      { ...EXAMPLE_MESSAGE, focus: EXAMPLE_POINT_ID },
      EXAMPLE_POINT_STORE
    );

    const results = await db.searchMessagesForPoints([EXAMPLE_POINT]);

    t.equal(results.length, 1, "Found message in search");
  } catch (e) {
    t.error(e);
  } finally {
    if (db) await db.close();
  }
});

test("Able to search for points by their text contents", async (t) => {
  t.plan(2)
  try {
    var db = await getNew('hyper://t5');

    await db.addPoint({ content: "Hello world", _id: "one" });
    await db.addPoint({ content: "Goodbye world", _id: "two" });

    const results1 = await db.searchPointsByContent("world");
    const results1Ids = results1.map(({ _id }) => _id);

    // Note that the sort order has newer points first
    t.deepEqual(results1Ids, ["two", "one"], "Got expected point IDs");

    const results2 = await db.searchPointsByContent("hello");
    const results2Ids = results2.map(({ _id }) => _id);

    t.deepEqual(results2Ids, ["one"], "Got just the matching points");
  } catch (e) {
    t.error(e);
  } finally {
    if (db) await db.close();
  }
});

function makePoint(point = {}) {
  const _id = Date.now() + "";

  return { _id, ...EXAMPLE_POINT, ...point };
}
