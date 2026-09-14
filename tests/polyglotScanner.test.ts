import { parsePolyglotFile } from "../src/engine/polyglotScanner.js";

describe("Kuma Polyglot AST Scanner", () => {
  it("parses Python class, async def, docstring, parameters, and imports", () => {
    const pythonCode = `
import os, sys
from app.models import User, Transaction

class PaymentGateway(BaseService):
    """Handles credit card and crypto billing."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        
    async def process_charge(self, amount: float, currency: str = "USD") -> dict:
        """Process a single transaction charge."""
        validate_currency(currency)
        return {"status": "success", "amount": amount}
`;

    const res = parsePolyglotFile("src/services/billing.py", pythonCode);
    expect(res.symbols).toHaveLength(3); // PaymentGateway, __init__, process_charge

    const cls = res.symbols.find((s) => s.name === "PaymentGateway");
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe("class");
    expect(cls?.description).toContain("Handles credit card and crypto billing");
    expect(cls?.extends).toBe("BaseService");

    const fn = res.symbols.find((s) => s.name === "process_charge");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.description).toContain("Process a single transaction charge");
    expect(fn?.signature).toContain("def process_charge");
    expect(fn?.returnType).toBe("dict");

    expect(res.imports).toHaveLength(3); // os, sys, app.models
    expect(res.calledSymbols).toContain("validate_currency");
  });

  it("parses Go struct, interface, receiver methods, and doc comments", () => {
    const goCode = `
package storage

import (
    "context"
    "database/sql"
)

// Store provides access to relational entities.
type Store struct {
    db *sql.DB
}

// UserStore defines query contracts for users.
type UserStore interface {
    FindByID(ctx context.Context, id string) (*User, error)
}

// NewStore initializes a new Store instance.
func NewStore(db *sql.DB) *Store {
    return &Store{db: db}
}

// GetUser retrieves a user by ID.
func (s *Store) GetUser(ctx context.Context, id string) (*User, error) {
    s.logQuery("SELECT user")
    return nil, nil
}
`;

    const res = parsePolyglotFile("pkg/storage/store.go", goCode);
    expect(res.symbols.length).toBeGreaterThanOrEqual(4);

    const storeStruct = res.symbols.find((s) => s.name === "Store");
    expect(storeStruct).toBeDefined();
    expect(storeStruct?.kind).toBe("class");
    expect(storeStruct?.description).toContain("Store provides access to relational entities");

    const userStore = res.symbols.find((s) => s.name === "UserStore");
    expect(userStore).toBeDefined();
    expect(userStore?.kind).toBe("interface");

    const getUser = res.symbols.find((s) => s.name === "GetUser");
    expect(getUser).toBeDefined();
    expect(getUser?.signature).toContain("func (s *Store) GetUser");

    expect(res.imports).toHaveLength(2);
    expect(res.calledSymbols).toContain("logQuery");
  });

  it("parses Rust structs, traits, pub fn, and doc comments", () => {
    const rustCode = `
use std::sync::Arc;
use tokio::sync::Mutex;

/// Primary cache layer for session metadata
pub struct SessionCache {
    entries: Arc<Mutex<Vec<String>>>,
}

/// Interface for key-value engines
pub trait KeyValueEngine {
    fn get(&self, key: &str) -> Option<String>;
}

/// Fetch session by token string
pub async fn fetch_session(token: &str) -> Result<Session, Error> {
    validate_token(token);
    Ok(Session::new())
}
`;

    const res = parsePolyglotFile("src/cache/session.rs", rustCode);
    expect(res.symbols).toHaveLength(4);

    const structNode = res.symbols.find((s) => s.name === "SessionCache");
    expect(structNode).toBeDefined();
    expect(structNode?.description).toContain("Primary cache layer for session metadata");

    const traitNode = res.symbols.find((s) => s.name === "KeyValueEngine");
    expect(traitNode).toBeDefined();
    expect(traitNode?.kind).toBe("interface");

    const fnNode = res.symbols.find((s) => s.name === "fetch_session");
    expect(fnNode).toBeDefined();
    expect(fnNode?.signature).toContain("fn fetch_session");
    expect(fnNode?.returnType).toBe("Result<Session, Error>");

    expect(res.imports.length).toBeGreaterThanOrEqual(2);
    expect(res.calledSymbols).toContain("validate_token");
  });
});
