import logging

from flask import Flask

from config import Config


def create_app():
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)
    app.secret_key = app.config["SECRET_KEY"]
    Config.warn_if_insecure(app.logger)

    if not app.debug:
        app.logger.setLevel(logging.INFO)

    from app.models import create_default_admin, init_db
    from app.routes import main_bp

    app.register_blueprint(main_bp)

    with app.app_context():
        init_db()
        create_default_admin()

    return app
