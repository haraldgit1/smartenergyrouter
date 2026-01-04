# console_api/rabbitmq_publisher.py
import json
import os
import pika

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://admin:admin@rabbitmq:5672/")

def get_connection():
    params = pika.URLParameters(RABBITMQ_URL)
    return pika.BlockingConnection(params)

def publish_optimize_request(message: dict):
    """
    Publisht eine Optimierungsanfrage auf die Queue 'optimize.requests'.
    """
    connection = get_connection()
    channel = connection.channel()

    # Queue deklarieren (idempotent)
    channel.queue_declare(queue="optimize.requests", durable=True)

    body = json.dumps(message)
    channel.basic_publish(
        exchange="",
        routing_key="optimize.requests",
        body=body.encode("utf-8"),
        properties=pika.BasicProperties(
            delivery_mode=2  # persistent
        )
    )
    connection.close()

