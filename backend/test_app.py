import unittest
from unittest.mock import patch

import cv2
import httpx
import numpy as np
from fastapi.testclient import TestClient

try:
    from . import app as app_module
except ImportError:
    import app as app_module

OUTPUT_DIR = app_module.OUTPUT_DIR
app = app_module.app
REAL_ASYNC_CLIENT = httpx.AsyncClient


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_rejects_non_doubao_url(self):
        response = self.client.post(
            "/api/video/parse", json={"text": "https://example.com/thread/abc"}
        )
        self.assertEqual(response.status_code, 400)

    def video_response(self, bugpk):
        def handler(request):
            self.assertEqual(request.url.host, "api.bugpk.com")
            if isinstance(bugpk, Exception):
                raise bugpk
            return httpx.Response(200, json=bugpk)

        transport = httpx.MockTransport(handler)
        with patch.object(
            app_module.httpx,
            "AsyncClient",
            lambda **kwargs: REAL_ASYNC_CLIENT(transport=transport, **kwargs),
        ):
            return self.client.post(
                "/api/video/parse",
                json={
                    "text": "https://www.doubao.com/video-sharing?video_id=v012345"
                },
            )

    def test_video_succeeds_without_legacy_doubao_requests(self):
        clean_url = "https://cdn.example/video.mp4?lr=unwatermarked"
        response = self.video_response(
            {"code": 200, "data": {"url": clean_url}}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["url"], clean_url)

    def test_video_rejects_missing_or_watermarked_source(self):
        missing = self.video_response({"code": 500, "data": {}})
        self.assertEqual(missing.status_code, 502)
        watermarked = self.video_response(
            {
                "code": 200,
                "data": {
                    "url": "https://cdn.example/video.mp4?lr=video_gen_watermark_dyn"
                },
            }
        )
        self.assertEqual(watermarked.status_code, 502)

    def test_video_reports_no_watermark_timeout(self):
        response = self.video_response(httpx.ReadTimeout("timeout"))
        self.assertEqual(response.status_code, 504)

    def test_inpaint_bounds_and_pixels(self):
        source = np.zeros((80, 100, 3), np.uint8)
        for column in range(100):
            source[:, column] = (column, 120, 220 - column)
        source[25:45, 35:65] = 255
        ok, encoded = cv2.imencode(".png", source)
        self.assertTrue(ok)
        files = {"image": ("watermark.png", encoded.tobytes(), "image/png")}

        invalid = self.client.post(
            "/api/image/inpaint",
            files=files,
            data={"x": 95, "y": 70, "width": 10, "height": 12},
        )
        self.assertEqual(invalid.status_code, 400)

        result = self.client.post(
            "/api/image/inpaint",
            files=files,
            data={"x": 35, "y": 25, "width": 30, "height": 20},
        )
        self.assertEqual(result.status_code, 200)
        output = cv2.imdecode(
            np.frombuffer((OUTPUT_DIR / "latest.png").read_bytes(), np.uint8),
            cv2.IMREAD_COLOR,
        )
        self.assertIsNotNone(output)
        self.assertEqual(output.shape, source.shape)
        self.assertTrue(np.any(output[25:45, 35:65] != source[25:45, 35:65]))
        self.assertTrue(np.array_equal(output[0:10, 0:10], source[0:10, 0:10]))


if __name__ == "__main__":
    unittest.main()
