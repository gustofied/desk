import json
import logging.config
import pathlib


def setup_logging() -> None:
    config_file = pathlib.Path(__file__).with_name("logging.json")

    with config_file.open(encoding="utf-8") as file:
        config = json.load(file)

    logging.config.dictConfig(config)
