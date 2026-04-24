"""Tests for PageIndex service."""
import os
import sys
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.pageindex.pageindex_service import (
    PageIndexService,
    DocType,
    TreeIndex,
    compute_project_id,
    compute_doc_hash,
    detect_doc_type,
)


class TestHelperFunctions:
    def test_compute_project_id_consistent(self):
        path = "/home/user/project"
        id1 = compute_project_id(path)
        id2 = compute_project_id(path)
        assert id1 == id2
        assert len(id1) == 16

    def test_compute_project_id_different_paths(self):
        id1 = compute_project_id("/path/a")
        id2 = compute_project_id("/path/b")
        assert id1 != id2

    def test_compute_doc_hash(self):
        content = "# Test Document\n\nSome content here."
        hash1 = compute_doc_hash(content)
        hash2 = compute_doc_hash(content)
        assert hash1 == hash2
        assert len(hash1) == 64  # SHA256 hex

    def test_compute_doc_hash_different_content(self):
        hash1 = compute_doc_hash("content a")
        hash2 = compute_doc_hash("content b")
        assert hash1 != hash2

    def test_detect_doc_type_roadmap(self):
        assert detect_doc_type("ROADMAP.md") == DocType.ROADMAP
        assert detect_doc_type("docs/ROADMAP.md") == DocType.ROADMAP
        assert detect_doc_type("project-roadmap.md") == DocType.ROADMAP

    def test_detect_doc_type_architecture(self):
        assert detect_doc_type("ARCHITECTURE.md") == DocType.ARCHITECTURE
        assert detect_doc_type("docs/architecture.md") == DocType.ARCHITECTURE

    def test_detect_doc_type_readme(self):
        assert detect_doc_type("README.md") == DocType.README
        assert detect_doc_type("readme.md") == DocType.README

    def test_detect_doc_type_documentation(self):
        assert detect_doc_type("docs/guide.md") == DocType.DOCUMENTATION
        assert detect_doc_type("USER_GUIDE.md") == DocType.DOCUMENTATION

    def test_detect_doc_type_other(self):
        assert detect_doc_type("random.md") == DocType.OTHER
        assert detect_doc_type("notes.md") == DocType.OTHER


class TestTreeIndex:
    def test_tree_index_default_values(self):
        index = TreeIndex()
        assert index.id is None
        assert index.project_id == ""
        assert index.doc_path == ""
        assert index.doc_type == DocType.OTHER
        assert index.tree_structure == {}

    def test_tree_index_with_values(self):
        index = TreeIndex(
            id="test-id",
            project_id="proj123",
            doc_path="ROADMAP.md",
            doc_type=DocType.ROADMAP,
            tree_structure={"doc_name": "test", "structure": []},
        )
        assert index.id == "test-id"
        assert index.project_id == "proj123"
        assert index.doc_type == DocType.ROADMAP


class TestPageIndexService:
    @pytest.fixture
    def mock_conn(self):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.__enter__ = MagicMock(return_value=cursor)
        cursor.__exit__ = MagicMock(return_value=None)
        cursor.fetchone.return_value = {
            "id": "test-uuid",
            "project_id": "proj123",
            "doc_path": "ROADMAP.md",
            "doc_type": "ROADMAP",
            "tree_structure": {"doc_name": "test"},
            "doc_hash": "abc123",
            "created_at": None,
            "updated_at": None,
        }
        conn.cursor.return_value = cursor
        return conn

    @patch("scripts.pageindex.pageindex_service.psycopg2")
    def test_store_tree(self, mock_psycopg2, mock_conn):
        mock_psycopg2.connect.return_value = mock_conn

        service = PageIndexService()
        result = service.store_tree(
            project_path="/home/user/project",
            doc_path="ROADMAP.md",
            tree_structure={"doc_name": "test", "structure": []},
            doc_content="# Roadmap\n\nContent",
        )

        assert result.doc_path == "ROADMAP.md"
        assert result.doc_type == DocType.ROADMAP

    @patch("scripts.pageindex.pageindex_service.psycopg2")
    def test_get_tree_found(self, mock_psycopg2, mock_conn):
        mock_psycopg2.connect.return_value = mock_conn

        service = PageIndexService()
        result = service.get_tree("/home/user/project", "ROADMAP.md")

        assert result is not None
        assert result.doc_path == "ROADMAP.md"

    @patch("scripts.pageindex.pageindex_service.psycopg2")
    def test_get_tree_not_found(self, mock_psycopg2, mock_conn):
        cursor = mock_conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = None
        mock_psycopg2.connect.return_value = mock_conn

        service = PageIndexService()
        result = service.get_tree("/home/user/project", "nonexistent.md")

        assert result is None

    @patch("scripts.pageindex.pageindex_service.psycopg2")
    def test_needs_reindex_no_existing(self, mock_psycopg2, mock_conn):
        cursor = mock_conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = None
        mock_psycopg2.connect.return_value = mock_conn

        service = PageIndexService()
        result = service.needs_reindex("/project", "doc.md", "content")

        assert result is True

    @patch("scripts.pageindex.pageindex_service.psycopg2")
    def test_needs_reindex_unchanged(self, mock_psycopg2, mock_conn):
        content = "# Test"
        expected_hash = compute_doc_hash(content)
        cursor = mock_conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {
            "id": "test-uuid",
            "project_id": "proj123",
            "doc_path": "doc.md",
            "doc_type": "OTHER",
            "tree_structure": {},
            "doc_hash": expected_hash,
            "created_at": None,
            "updated_at": None,
        }
        mock_psycopg2.connect.return_value = mock_conn

        service = PageIndexService()
        result = service.needs_reindex("/project", "doc.md", content)

        assert result is False

    @patch("scripts.pageindex.pageindex_service.psycopg2")
    def test_needs_reindex_changed(self, mock_psycopg2, mock_conn):
        cursor = mock_conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {
            "id": "test-uuid",
            "project_id": "proj123",
            "doc_path": "doc.md",
            "doc_type": "OTHER",
            "tree_structure": {},
            "doc_hash": "old_hash",
            "created_at": None,
            "updated_at": None,
        }
        mock_psycopg2.connect.return_value = mock_conn

        service = PageIndexService()
        result = service.needs_reindex("/project", "doc.md", "new content")

        assert result is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
