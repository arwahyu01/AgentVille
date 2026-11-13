import os
import shutil
import tempfile

# Must happen before anything imports app.database: that module reads the env var at
# import time and would otherwise point SessionLocal at the real data/agentville.db,
# so any endpoint that bypasses the get_db override would write user data.
_TMP_DIR = tempfile.mkdtemp(prefix="agentville-test-")
os.environ["AGENTVILLE_DATABASE_URL"] = f"sqlite:///{os.path.join(_TMP_DIR, 'test.db')}"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app import models

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)

@event.listens_for(engine, "connect")
def _fk_on(dbapi_connection, record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def _override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = _override_get_db

@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(engine)
    with TestingSession() as db:
        db.add(models.Agent(name="Atlas", role="AI Coordinator", status="idle", position_x=0.0, position_z=0.0))
        db.add(models.Agent(name="Byte", role="Developer", status="idle", position_x=1.0, position_z=0.0))
        db.commit()
    yield
    Base.metadata.drop_all(engine)

@pytest.fixture
def client() -> TestClient:
    return TestClient(app)

@pytest.fixture
def session_factory():
    return TestingSession

@pytest.fixture
def agent_id(client: TestClient) -> int:
    return client.get("/api/agents").json()[0]["id"]


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP_DIR, ignore_errors=True)
