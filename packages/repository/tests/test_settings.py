import pytest
from onko_repository.settings import parse_connection_string


def test_parses_connection_string():
    conn = parse_connection_string("iris://dev%40team:p%3Ass@iris.example.azure.com:1972/ONKO")
    assert conn.dsn == "iris.example.azure.com:1972/ONKO"
    assert (conn.username, conn.password) == ("dev@team", "p:ss")


def test_defaults_superserver_port():
    assert parse_connection_string("iris://u:p@host/ONKO").port == 1972


@pytest.mark.parametrize("bad", ["postgres://u:p@h/db", "iris://host:1972/ONKO", "iris://u:p@host:1972"])
def test_rejects_incomplete(bad):
    with pytest.raises(ValueError):
        parse_connection_string(bad)
