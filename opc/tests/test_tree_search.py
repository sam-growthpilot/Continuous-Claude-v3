"""Tests for PageIndex tree search."""
import sys
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.pageindex.tree_search import (
    format_tree_for_prompt,
    get_node_by_id,
    tree_search,
    format_search_results,
    SearchResult,
)


class TestFormatTreeForPrompt:
    def test_empty_structure(self):
        result = format_tree_for_prompt([])
        assert result == ""

    def test_flat_structure(self):
        tree = [
            {"node_id": "0001", "title": "Introduction"},
            {"node_id": "0002", "title": "Goals"},
        ]
        result = format_tree_for_prompt(tree)
        assert "[0001] Introduction" in result
        assert "[0002] Goals" in result

    def test_nested_structure(self):
        tree = [
            {
                "node_id": "0001",
                "title": "Goals",
                "nodes": [
                    {"node_id": "0002", "title": "Q1 Goals"},
                    {"node_id": "0003", "title": "Q2 Goals"},
                ],
            }
        ]
        result = format_tree_for_prompt(tree)
        lines = result.split("\n")
        assert "[0001] Goals" in lines[0]
        assert "  [0002] Q1 Goals" in lines[1]
        assert "  [0003] Q2 Goals" in lines[2]

    def test_structure_with_wrapper(self):
        tree = {
            "doc_name": "test",
            "structure": [
                {"node_id": "0001", "title": "Section 1"},
            ],
        }
        result = format_tree_for_prompt(tree)
        assert "[0001] Section 1" in result


class TestGetNodeById:
    def test_find_root_node(self):
        tree = [
            {"node_id": "0001", "title": "Root", "text": "Root content"},
        ]
        result = get_node_by_id(tree, "0001")
        assert result is not None
        assert result["title"] == "Root"

    def test_find_nested_node(self):
        tree = [
            {
                "node_id": "0001",
                "title": "Parent",
                "nodes": [
                    {"node_id": "0002", "title": "Child", "text": "Child content"},
                ],
            }
        ]
        result = get_node_by_id(tree, "0002")
        assert result is not None
        assert result["title"] == "Child"

    def test_node_not_found(self):
        tree = [{"node_id": "0001", "title": "Only"}]
        result = get_node_by_id(tree, "9999")
        assert result is None

    def test_with_structure_wrapper(self):
        tree = {
            "structure": [
                {"node_id": "0001", "title": "Section"},
            ]
        }
        result = get_node_by_id(tree, "0001")
        assert result is not None
        assert result["title"] == "Section"


class TestTreeSearch:
    @patch("scripts.pageindex.tree_search.claude_complete")
    def test_tree_search_basic(self, mock_claude):
        mock_claude.return_value = '[{"node_id": "0001", "relevance_reason": "matches query", "confidence": 0.9}]'

        tree = {
            "structure": [
                {"node_id": "0001", "title": "Goals", "text": "Project goals"},
            ]
        }
        results = tree_search("project goals", tree, doc_name="test.md")

        assert len(results) == 1
        assert results[0].node_id == "0001"
        assert results[0].title == "Goals"
        assert results[0].confidence == 0.9

    @patch("scripts.pageindex.tree_search.claude_complete")
    def test_tree_search_multiple_results(self, mock_claude):
        mock_claude.return_value = """[
            {"node_id": "0001", "relevance_reason": "main match", "confidence": 0.95},
            {"node_id": "0002", "relevance_reason": "related", "confidence": 0.7}
        ]"""

        tree = {
            "structure": [
                {"node_id": "0001", "title": "Section A", "text": "Content A"},
                {"node_id": "0002", "title": "Section B", "text": "Content B"},
            ]
        }
        results = tree_search("test query", tree)

        assert len(results) == 2
        assert results[0].confidence > results[1].confidence

    @patch("scripts.pageindex.tree_search.claude_complete")
    def test_tree_search_no_results(self, mock_claude):
        mock_claude.return_value = "[]"

        tree = {"structure": [{"node_id": "0001", "title": "Section"}]}
        results = tree_search("unrelated query", tree)

        assert len(results) == 0

    @patch("scripts.pageindex.tree_search.claude_complete")
    def test_tree_search_invalid_json(self, mock_claude):
        mock_claude.return_value = "Invalid response"

        tree = {"structure": [{"node_id": "0001", "title": "Section"}]}
        results = tree_search("test", tree)

        assert len(results) == 0

    @patch("scripts.pageindex.tree_search.claude_complete")
    def test_tree_search_respects_max_results(self, mock_claude):
        mock_claude.return_value = """[
            {"node_id": "0001", "relevance_reason": "match", "confidence": 0.9},
            {"node_id": "0002", "relevance_reason": "match", "confidence": 0.8},
            {"node_id": "0003", "relevance_reason": "match", "confidence": 0.7}
        ]"""

        tree = {
            "structure": [
                {"node_id": "0001", "title": "A", "text": "A"},
                {"node_id": "0002", "title": "B", "text": "B"},
                {"node_id": "0003", "title": "C", "text": "C"},
            ]
        }
        results = tree_search("test", tree, max_results=2)

        assert len(results) == 2


class TestFormatSearchResults:
    def test_format_empty_results(self):
        result = format_search_results([])
        assert "No relevant sections found" in result

    def test_format_single_result(self):
        results = [
            SearchResult(
                node_id="0001",
                title="Test Section",
                text="Test content",
                line_num=10,
                relevance_reason="matches query",
                confidence=0.9,
            )
        ]
        output = format_search_results(results)
        assert "[0001]" in output
        assert "Test Section" in output
        assert "90%" in output

    def test_format_with_text(self):
        results = [
            SearchResult(
                node_id="0001",
                title="Section",
                text="Full content here",
                line_num=5,
                relevance_reason="reason",
                confidence=0.8,
            )
        ]
        output = format_search_results(results, include_text=True)
        assert "Full content here" in output


class TestSearchResult:
    def test_search_result_creation(self):
        result = SearchResult(
            node_id="0001",
            title="Test",
            text="Content",
            line_num=42,
            relevance_reason="Relevant because X",
            confidence=0.85,
        )
        assert result.node_id == "0001"
        assert result.title == "Test"
        assert result.line_num == 42
        assert result.confidence == 0.85


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
