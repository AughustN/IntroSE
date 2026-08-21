"""Merge crawler exports into one portable events dataset.

Creates ../events/events.csv and ../events/images from the three crawler
sources.  Image filenames are prefixed with their source to prevent clashes.
"""

from __future__ import annotations

import csv
import shutil
from pathlib import Path


SOURCES = ("data_cticket", "data_eventbrite", "data_ticketbox")


def main() -> None:
    crawl_dir = Path(__file__).resolve().parent
    output_dir = crawl_dir.parent / "events"
    images_dir = output_dir / "images"

    # The output is rebuilt so it always mirrors the current three exports.
    if output_dir.exists():
        shutil.rmtree(output_dir)
    images_dir.mkdir(parents=True)

    rows: list[dict[str, str]] = []
    fieldnames: list[str] | None = None

    for source in SOURCES:
        source_dir = crawl_dir / source
        csv_path = source_dir / "events.csv"
        source_images = source_dir / "images"

        with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            if reader.fieldnames is None:
                raise ValueError(f"Missing header in {csv_path}")
            if fieldnames is None:
                fieldnames = reader.fieldnames
            elif reader.fieldnames != fieldnames:
                raise ValueError(f"CSV schema differs in {csv_path}")

            for row in reader:
                source_name = source.removeprefix("data_")
                # A compact canonical ID for the merged dataset.
                row["event_id"] = f"EVT{len(rows) + 1:06d}"
                old_image = row.get("local_image", "")
                if old_image:
                    image_name = Path(old_image.replace("\\", "/")).name
                    source_image = source_images / image_name
                    if not source_image.is_file():
                        raise FileNotFoundError(f"Image referenced by CSV not found: {source_image}")
                    merged_name = f"{source}_{image_name}"
                    shutil.copy2(source_image, images_dir / merged_name)
                    row["local_image"] = f"images/{merged_name}"
                row["source"] = source_name
                rows.append(row)

    if fieldnames is None:
        raise ValueError("No input CSV files found")

    with (output_dir / "events.csv").open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(
            csv_file, fieldnames=[*fieldnames, "source"]
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Created {output_dir / 'events.csv'} with {len(rows)} events and {len(list(images_dir.iterdir()))} images.")


if __name__ == "__main__":
    main()
