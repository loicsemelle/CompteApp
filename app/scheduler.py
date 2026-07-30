import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from app.db import get_setting
from app.sync import run_sync

# Set up logging for scheduler
logging.getLogger('apscheduler').setLevel(logging.WARNING)
logger = logging.getLogger("app.scheduler")

scheduler = BackgroundScheduler()
JOB_ID = "bank_sync_job"

def sync_job_wrapper():
    """Wrapper function to handle scheduled sync execution."""
    logger.info("Executing scheduled synchronization job...")
    try:
        run_sync()
    except Exception as e:
        logger.error(f"Error during scheduled synchronization: {e}")

def start_scheduler():
    """Start the background scheduler."""
    if not scheduler.running:
        scheduler.start()
        logger.info("Background scheduler started successfully.")
    configure_job()

def stop_scheduler():
    """Shutdown the background scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Background scheduler stopped.")

def configure_job():
    """Read configuration and schedule or update the sync job."""
    try:
        interval_hours = int(get_setting("sync_interval_hours", 24))
    except (ValueError, TypeError):
        interval_hours = 24
        
    # Check if job already exists and remove it to re-schedule
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
        
    if interval_hours > 0:
        scheduler.add_job(
            sync_job_wrapper,
            IntervalTrigger(hours=interval_hours),
            id=JOB_ID,
            replace_existing=True
        )
        logger.info(f"Sync job scheduled to run every {interval_hours} hour(s).")
    else:
        logger.info("Automatic sync job scheduling is disabled (interval = 0).")
