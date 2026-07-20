const DATABASE_NAME = "tinyide-state";
const DATABASE_VERSION = 1;
const STORE_NAME = "session";
const SNAPSHOT_KEY = "application-snapshot";

let databasePromise: Promise<IDBDatabase> | undefined;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed.")), {
      once: true,
    });
  });
}

function transactionCompleted(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted.")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => {
        database.close();
        databasePromise = undefined;
      });
      resolve(database);
    }, { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Unable to open the tinyIde state database.")),
      { once: true },
    );
  });

  return databasePromise;
}

export async function readApplicationSnapshot<T>(): Promise<T | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const completed = transactionCompleted(transaction);
  const value = await requestResult(transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY));
  await completed;
  return value as T | undefined;
}

export async function writeApplicationSnapshot<T>(snapshot: T): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = transactionCompleted(transaction);
  await requestResult(transaction.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY));
  await completed;
}

export async function clearApplicationSnapshot(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = transactionCompleted(transaction);
  await requestResult(transaction.objectStore(STORE_NAME).delete(SNAPSHOT_KEY));
  await completed;
}
