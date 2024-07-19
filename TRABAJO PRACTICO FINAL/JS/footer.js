document.addEventListener("DOMContentLoaded", function () {
    var footer = `
        <footer>
            <div class="footer-content">
                <div class="social-icons">
                    <a href="https://wa.me/1234567890" target="_blank" class="whatsapp">
                        <i class="lab la-whatsapp"></i>
                    </a>
                    <a href="https://www.facebook.com" target="_blank" class="facebook">
                        <i class="lab la-facebook"></i>
                    </a>
                    <a href="https://www.instagram.com" target="_blank" class="instagram">
                        <i class="lab la-instagram"></i>
                    </a>
                    <a href="https://www.twitter.com" target="_blank" class="twitter">
                        <i class="lab la-twitter"></i>
                    </a>
                </div>
            </div>
        </footer>
    `;
    document.body.insertAdjacentHTML('beforeend', footer);
});
