"""
Background job workers
"""

import logging
import traceback
from datetime import timedelta
from multiprocessing import Process
from sched import scheduler
from time import monotonic, sleep

from google.protobuf import empty_pb2
from prometheus_client import start_http_server
from sqlalchemy.sql import func

from couchers.db import get_engine, session_scope
from couchers.jobs.definitions import JOBS, SCHEDULE
from couchers.jobs.enqueue import queue_job
from couchers.metrics import jobs_counter, jobs_process_registry
from couchers.models import BackgroundJob, BackgroundJobState, BackgroundJobType
from couchers.utils import now

logger = logging.getLogger(__name__)


def process_job():
    """
    Attempt to process one job from the job queue. Returns False if no job was found, True if a job was processed,
    regardless of failure/success.
    """
    logger.debug(f"Looking for a job")
    with session_scope(isolation_level="REPEATABLE READ") as session:
        # a combination of REPEATABLE READ and SELECT ... FOR UPDATE SKIP LOCKED makes sure that only one transaction
        # will modify the job at a time. SKIP UPDATE means that if the job is locked, then we ignore that row, it's
        # easier to use SKIP LOCKED vs NOWAIT in the ORM, with NOWAIT you get an ugly exception from deep inside
        # psycopg2 that's quite annoying to catch and deal with
        job = (
            session.query(BackgroundJob).filter(BackgroundJob.ready_for_retry).with_for_update(skip_locked=True).first()
        )

        if not job:
            logger.debug(f"No pending jobs")
            return False

        # we've got a lock for a job now, it's "pending" until we commit or the lock is gone
        logger.info(f"Job #{job.id} grabbed")

        job.try_count += 1

        message_type, func = JOBS[job.job_type]

        try:
            ret = func(message_type.FromString(job.payload))
            job.state = BackgroundJobState.completed
            jobs_counter.labels(job.job_type.name, job.state.name, str(job.try_count), "").inc()
            logger.info(f"Job #{job.id} complete on try number {job.try_count}")
        except Exception as e:
            logger.exception(e)
            if job.try_count >= job.max_tries:
                # if we already tried max_tries times, it's permanently failed
                job.state = BackgroundJobState.failed
                logger.info(f"Job #{job.id} failed on try number {job.try_count}")
            else:
                job.state = BackgroundJobState.error
                # exponential backoff
                job.next_attempt_after += timedelta(seconds=15 * (2 ** job.try_count))
                logger.info(f"Job #{job.id} error on try number {job.try_count}, next try at {job.next_attempt_after}")
            # add some info for debugging
            jobs_counter.labels(job.job_type.name, job.state.name, str(job.try_count), type(e).__name__).inc()
            job.failure_info = traceback.format_exc()

        # exiting ctx manager commits and releases the row lock
    return True


def service_jobs():
    """
    Service jobs in an infinite loop
    """
    # multiprocessing uses fork() which in turn copies file descriptors, so the engine may have connections in its pool
    # that we don't want to reuse. This is the SQLALchemy-recommended way of clearing the connection pool in this thread
    get_engine().dispose()

    # This line is commented out because it is possible that this code runs twice
    # That leads to a crash because 8001 is already in use
    # We should fix that problem soon
    # start_http_server(8001, registry=jobs_process_registry)

    while True:
        # if no job was found, sleep for a second, otherwise query for another job straight away
        if not process_job():
            sleep(1)


def _run_job_and_schedule(sched, schedule_id):
    job_type, frequency = SCHEDULE[schedule_id]
    logger.info(f"Processing job of type {job_type}")

    # wake ourselves up after frequency
    sched.enter(
        frequency.total_seconds(),
        1,
        _run_job_and_schedule,
        argument=(
            sched,
            schedule_id,
        ),
    )

    # queue the job
    queue_job(job_type, empty_pb2.Empty())


def run_scheduler():
    """
    Schedules jobs according to schedule in .definitions
    """
    # multiprocessing uses fork() which in turn copies file descriptors, so the engine may have connections in its pool
    # that we don't want to reuse. This is the SQLALchemy-recommended way of clearing the connection pool in this thread
    get_engine().dispose()

    sched = scheduler(monotonic, sleep)

    for schedule_id, (job_type, frequency) in enumerate(SCHEDULE):
        sched.enter(
            0,
            1,
            _run_job_and_schedule,
            argument=(
                sched,
                schedule_id,
            ),
        )

    sched.run()


def _run_forever(func):
    while True:
        try:
            logger.critical("Background worker starting")
            func()
        except Exception as e:
            logger.critical("Unhandled exception in background worker", exc_info=e)
            # cool off in case we have some programming error to not hammer the database
            sleep(60)


def start_jobs_scheduler():
    scheduler = Process(target=_run_forever, args=(run_scheduler,))
    scheduler.start()
    return scheduler


def start_jobs_worker():
    worker = Process(target=_run_forever, args=(service_jobs,))
    worker.start()
    return worker
