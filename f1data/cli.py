from __future__ import annotations

import sys
from pathlib import Path
from typing import List

import click
from rich.console import Console
from rich.table import Table

from .scraper import (
    DEFAULT_START_YEAR,
    DEFAULT_END_YEAR,
    scrape_races_for_year,
    scrape_drivers_for_year,
    scrape_teams_for_year,
    scrape_fastest_laps_for_year,
    scrape_race_results_for_year,
)
from .db import Database

console = Console()


def _year_range(start: int, end: int) -> List[int]:
    return list(range(int(start), int(end) + 1))


@click.group()
def cli() -> None:
    """Local F1 data toolkit (races, drivers, teams, awards)."""


@cli.command()
@click.option("--year", type=int, help="Single season to scrape")
@click.option("--start", type=int, default=DEFAULT_START_YEAR, show_default=True, help="Start season")
@click.option("--end", type=int, default=DEFAULT_END_YEAR, show_default=True, help="End season")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def scrape(year: int | None, start: int, end: int, db_path: str) -> None:
    """Scrape races from formula1.com and store in SQLite."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    db = Database(db_path)

    years = [year] if year else _year_range(start, end)

    total_rows = 0
    for y in years:
        console.rule(f"[bold cyan]Scraping races for {y}")
        try:
            races = scrape_races_for_year(y)
        except Exception as exc:
            console.print(f"[red]Failed to scrape {y}[/red]: {exc}")
            continue

        # Internal verification: ensure contiguous rounds
        round_numbers = [r.round_number for r in races]
        contiguous = round_numbers == list(range(1, len(races) + 1))
        if not contiguous:
            console.print("[yellow]Warning[/yellow]: Non-contiguous round numbers detected.")

        inserted = db.upsert_races(races)
        total_rows += inserted
        console.print(f"Stored/updated [green]{inserted}[/green] rows for {y}")

    console.rule("[bold green]Done")
    console.print(f"Total rows written: [bold]{total_rows}[/bold]")


@cli.command(name="scrape-drivers")
@click.option("--year", type=int, help="Single season to scrape")
@click.option("--start", type=int, default=DEFAULT_START_YEAR, show_default=True, help="Start season")
@click.option("--end", type=int, default=DEFAULT_END_YEAR, show_default=True, help="End season")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def scrape_drivers_cmd(year: int | None, start: int, end: int, db_path: str) -> None:
    """Scrape driver standings and store in SQLite."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    db = Database(db_path)

    years = [year] if year else _year_range(start, end)

    total_rows = 0
    for y in years:
        console.rule(f"[bold cyan]Scraping drivers for {y}")
        try:
            rows = scrape_drivers_for_year(y)
        except Exception as exc:
            console.print(f"[red]Failed to scrape drivers {y}[/red]: {exc}")
            continue

        # Internal checks: positions sequential, points non-negative
        positions = [r.position for r in rows]
        if positions != list(range(1, len(rows) + 1)):
            console.print("[yellow]Warning[/yellow]: Positions not sequential")
        if any(r.points < 0 for r in rows):
            console.print("[yellow]Warning[/yellow]: Negative points encountered")

        inserted = db.upsert_driver_standings(rows)
        total_rows += inserted
        console.print(f"Stored/updated [green]{inserted}[/green] driver rows for {y}")

    console.rule("[bold green]Done")
    console.print(f"Total rows written: [bold]{total_rows}[/bold]")


@cli.command(name="scrape-teams")
@click.option("--year", type=int, help="Single season to scrape")
@click.option("--start", type=int, default=DEFAULT_START_YEAR, show_default=True, help="Start season")
@click.option("--end", type=int, default=DEFAULT_END_YEAR, show_default=True, help="End season")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def scrape_teams_cmd(year: int | None, start: int, end: int, db_path: str) -> None:
    """Scrape team standings and store in SQLite."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    db = Database(db_path)

    years = [year] if year else _year_range(start, end)

    total_rows = 0
    for y in years:
        console.rule(f"[bold cyan]Scraping teams for {y}")
        try:
            rows = scrape_teams_for_year(y)
        except Exception as exc:
            console.print(f"[red]Failed to scrape teams {y}[/red]: {exc}")
            continue

        positions = [r.position for r in rows]
        if positions != list(range(1, len(rows) + 1)):
            console.print("[yellow]Warning[/yellow]: Positions not sequential")

        inserted = db.upsert_team_standings(rows)
        total_rows += inserted
        console.print(f"Stored/updated [green]{inserted}[/green] team rows for {y}")

    console.rule("[bold green]Done")
    console.print(f"Total rows written: [bold]{total_rows}[/bold]")


@cli.command(name="scrape-awards")
@click.option("--year", type=int, help="Single season to scrape")
@click.option("--start", type=int, default=DEFAULT_START_YEAR, show_default=True, help="Start season")
@click.option("--end", type=int, default=DEFAULT_END_YEAR, show_default=True, help="End season")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def scrape_awards_cmd(year: int | None, start: int, end: int, db_path: str) -> None:
    """Scrape awards (fastest laps) and store in SQLite."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    db = Database(db_path)

    years = [year] if year else _year_range(start, end)

    total_rows = 0
    for y in years:
        console.rule(f"[bold cyan]Scraping awards (fastest laps) for {y}")
        try:
            rows = scrape_fastest_laps_for_year(y)
        except Exception as exc:
            console.print(f"[red]Failed to scrape awards {y}[/red]: {exc}")
            continue

        inserted = db.upsert_fastest_laps(rows)
        total_rows += inserted
        console.print(f"Stored/updated [green]{inserted}[/green] fastest lap rows for {y}")

    console.rule("[bold green]Done")
    console.print(f"Total rows written: [bold]{total_rows}[/bold]")


@cli.command()
@click.option("--year", type=int, required=True, help="Season to browse")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def browse(year: int, db_path: str) -> None:
    """Browse races stored in SQLite for a season."""
    db = Database(db_path)
    rows = db.list_races(year)

    if not rows:
        console.print(f"[yellow]No races found for {year}. Run 'scrape' first.[/yellow]")
        sys.exit(0)

    table = Table(show_header=True, header_style="bold")
    for h in ("Rnd", "Grand Prix", "Date", "Winner", "Team", "Laps", "Time"):
        table.add_column(h)

    for r in rows:
        table.add_row(
            str(r["round"]),
            r["grand_prix"],
            r["date"],
            r["winner"],
            r["team"],
            "" if r["laps"] is None else str(r["laps"]),
            r["time"] or "",
        )

    console.print(table)


@cli.command(name="browse-drivers")
@click.option("--year", type=int, required=True, help="Season to browse")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def browse_drivers(year: int, db_path: str) -> None:
    """Browse driver standings stored in SQLite for a season."""
    db = Database(db_path)
    rows = db.list_driver_standings(year)

    if not rows:
        console.print(f"[yellow]No driver standings found for {year}. Run 'scrape-drivers' first.[/yellow]")
        sys.exit(0)

    table = Table(show_header=True, header_style="bold")
    for h in ("Pos", "Driver", "Nat", "Team", "Pts"):
        table.add_column(h)

    for r in rows:
        table.add_row(
            str(r["position"]),
            r["driver"],
            r["nationality"],
            r["team"],
            str(r["points"]),
        )

    console.print(table)


@cli.command(name="browse-teams")
@click.option("--year", type=int, required=True, help="Season to browse")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def browse_teams(year: int, db_path: str) -> None:
    """Browse team standings stored in SQLite for a season."""
    db = Database(db_path)
    rows = db.list_team_standings(year)

    if not rows:
        console.print(f"[yellow]No team standings found for {year}. Run 'scrape-teams' first.[/yellow]")
        sys.exit(0)

    table = Table(show_header=True, header_style="bold")
    for h in ("Pos", "Team", "Pts"):
        table.add_column(h)

    for r in rows:
        table.add_row(
            str(r["position"]),
            r["team"],
            str(r["points"]),
        )

    console.print(table)


@cli.command(name="browse-awards")
@click.option("--year", type=int, required=True, help="Season to browse")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def browse_awards(year: int, db_path: str) -> None:
    """Browse fastest-laps awards for a season."""
    db = Database(db_path)
    rows = db.list_fastest_laps(year)

    if not rows:
        console.print(f"[yellow]No fastest laps found for {year}. Run 'scrape-awards' first.[/yellow]")
        sys.exit(0)

    table = Table(show_header=True, header_style="bold")
    for h in ("Rnd", "Grand Prix", "Winner", "Time"):
        table.add_column(h)

    for r in rows:
        table.add_row(
            str(r["round"]),
            r["grand_prix"],
            r["winner"],
            r["time"],
        )

    console.print(table)


@cli.command(name="normalize")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def normalize_cmd(db_path: str) -> None:
    """Create normalized tables and populate them from current data."""
    db = Database(db_path)
    stats = db.normalize()

    table = Table(show_header=True, header_style="bold")
    table.add_column("Table")
    table.add_column("Rows")
    for k, v in stats.items():
        table.add_row(k, str(v))
    console.print(table)


@cli.command(name="serve")
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", type=int, default=8000, show_default=True)
@click.option("--reload/--no-reload", default=True, show_default=True)
def serve_cmd(host: str, port: int, reload: bool) -> None:
    """Run the web UI/API server."""
    import uvicorn

    # Import string required for reload to work (uvicorn must re-import the app)
    uvicorn.run(
        "f1data.server:app",
        host=host,
        port=port,
        reload=reload,
    )


@cli.command(name="scrape-results")
@click.option("--year", type=int, help="Single season to scrape")
@click.option("--start", type=int, default=DEFAULT_START_YEAR, show_default=True, help="Start season")
@click.option("--end", type=int, default=DEFAULT_END_YEAR, show_default=True, help="End season")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
def scrape_results_cmd(year: int | None, start: int, end: int, db_path: str) -> None:
    """Scrape per-race classifications and store in SQLite."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    db = Database(db_path)

    years = [year] if year else _year_range(start, end)

    total_rows = 0
    for y in years:
        console.rule(f"[bold cyan]Scraping race results for {y}")
        try:
            rows = scrape_race_results_for_year(y)
        except Exception as exc:
            console.print(f"[red]Failed to scrape results {y}[/red]: {exc}")
            continue
        inserted = db.upsert_race_results(rows)
        total_rows += inserted
        console.print(f"Stored/updated [green]{inserted}[/green] race-result rows for {y}")

    console.rule("[bold green]Done")
    console.print(f"Total rows written: [bold]{total_rows}[/bold]")


@cli.command(name="scrape-all")
@click.option("--year", type=int, help="Single season to scrape")
@click.option("--start", type=int, default=DEFAULT_START_YEAR, show_default=True, help="Start season")
@click.option("--end", type=int, default=DEFAULT_END_YEAR, show_default=True, help="End season")
@click.option("--db", "db_path", type=click.Path(dir_okay=False), default="data/f1.sqlite", show_default=True)
@click.option("--no-normalize", is_flag=True, help="Skip running normalize after scraping")
def scrape_all_cmd(
    year: int | None, start: int, end: int, db_path: str, no_normalize: bool
) -> None:
    """Scrape all data (races, drivers, teams, awards, race results) and optionally normalize."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    db = Database(db_path)
    years = [year] if year else _year_range(start, end)

    for y in years:
        console.rule(f"[bold cyan]Scraping all data for {y}")
        # Races
        try:
            races = scrape_races_for_year(y)
            db.upsert_races(races)
            console.print(f"  [green]Races[/green]: {len(races)}")
        except Exception as exc:
            console.print(f"  [red]Races failed[/red]: {exc}")
        try:
            rows = scrape_drivers_for_year(y)
            db.upsert_driver_standings(rows)
            console.print(f"  [green]Drivers[/green]: {len(rows)}")
        except Exception as exc:
            console.print(f"  [red]Drivers failed[/red]: {exc}")
        try:
            rows = scrape_teams_for_year(y)
            db.upsert_team_standings(rows)
            console.print(f"  [green]Teams[/green]: {len(rows)}")
        except Exception as exc:
            console.print(f"  [red]Teams failed[/red]: {exc}")
        try:
            rows = scrape_fastest_laps_for_year(y)
            db.upsert_fastest_laps(rows)
            console.print(f"  [green]Fastest laps[/green]: {len(rows)}")
        except Exception as exc:
            console.print(f"  [red]Fastest laps failed[/red]: {exc}")
        try:
            rows = scrape_race_results_for_year(y)
            db.upsert_race_results(rows)
            console.print(f"  [green]Race results[/green]: {len(rows)}")
        except Exception as exc:
            console.print(f"  [red]Race results failed[/red]: {exc}")

    if not no_normalize:
        console.rule("[bold cyan]Normalizing database")
        stats = db.normalize()
        for k, v in stats.items():
            console.print(f"  {k}: [green]{v}[/green]")

    console.rule("[bold green]Scrape-all complete[/bold green]")


if __name__ == "__main__":
    cli()
